import { reply } from "./commands";
import { log, now, type Ctx, type Env } from "./env";
import { Http, HttpError } from "./http";

/**
 * Sticky messages: /sticky keeps a message as the last one in a channel, like StickyBot. The bot answers slash
 * commands over HTTP and never sees chat as it happens, so the cron moves each sticky down instead: once a minute it
 * reads every sticky channel's latest message id (one request per server) and, where something was posted below the
 * sticky, posts it again at the bottom and deletes the old copy. A sticky therefore comes back within about a minute
 * of new messages, and busy channels see it at most once a minute.
 *
 * Who can use /sticky is set by Discord: the command is for administrators by default (scripts/commands.mjs), and a
 * server admin can let another role use it in Server Settings → Integrations → the bot → /sticky.
 */

const API = "https://discord.com/api/v10";
const EPHEMERAL = 64;
const MODAL = 9;
const MODAL_ID = "sticky:set";
const INPUT_ID = "content";
/** Discord's message limit. */
const MAX_LENGTH = 2000;
const MAX_PER_SERVER = 10;
/** Moves per cron run; the rest wait a minute. Each costs a post and a delete. */
const MAX_MOVES_PER_RUN = 5;
/** What the cron leaves of its subrequest budget for the merge poll after it. */
const RESERVE = 20;

interface Sticky {
  channel_id: string;
  guild_id: string;
  content: string;
  message_id: string | null;
  paused: number;
  set_by: string;
  updated_at: number;
}

export interface StickyInteraction {
  guild_id?: string;
  channel_id?: string;
  member?: { user: { id: string } };
  data?: { custom_id?: string; options?: { name: string }[]; components?: unknown[] };
}

const privately = (content: string) => reply({ content, flags: EPHEMERAL });

const botHeaders = (env: Env) => ({ authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" });

type Posted = { id: string } | { status: number };

/** Posts the sticky's text. Mentions in it render but never ping, however often it is posted again. */
async function post(env: Env, http: Http, channel: string, content: string): Promise<Posted> {
  const res = await http.send("discord sticky post", `${API}/channels/${channel}/messages`, {
    method: "POST",
    headers: botHeaders(env),
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (res.ok) return { id: (await res.json<{ id: string }>()).id };
  await res.body?.cancel();
  if (res.status === 403 || res.status === 404) return { status: res.status };
  throw new HttpError("discord sticky post", res.status);
}

/** Deletes an old copy. The bot may always delete its own messages; one already gone is fine. */
async function remove(env: Env, http: Http, channel: string, message: string | null): Promise<void> {
  if (!message) return;
  try {
    const res = await http.send("discord sticky delete", `${API}/channels/${channel}/messages/${message}`, { method: "DELETE", headers: botHeaders(env) });
    await res.body?.cancel();
    if (!res.ok && res.status !== 404) log("sticky_delete_failed", { channel, status: res.status });
  } catch (err) {
    // A copy left behind is untidy, not broken: the sticky itself is already where it should be.
    if (err instanceof HttpError) log("sticky_delete_failed", { channel, error: err.message });
    else throw err;
  }
}

const get = (env: Env, channel: string) => env.DB.prepare("SELECT * FROM stickies WHERE channel_id = ?").bind(channel).first<Sticky>();

const cannotPost = (status: number) =>
  status === 404
    ? "I can't find this channel."
    : "I can't post here. Give the bot **View Channel**, **Send Messages** and **Read Message History** in this channel, then try again.";

/** Posts a sticky at the bottom of its channel now and deletes the previous copy. Returns why it couldn't, if it couldn't. */
async function moveDown(env: Env, http: Http, sticky: Sticky): Promise<number | undefined> {
  const posted = await post(env, http, sticky.channel_id, sticky.content);
  if ("status" in posted) return posted.status;
  // Recorded before the delete, so a failed delete can never make the next run post it twice.
  await env.DB.prepare("UPDATE stickies SET message_id = ? WHERE channel_id = ?").bind(posted.id, sticky.channel_id).run();
  await remove(env, http, sticky.channel_id, sticky.message_id);
  return undefined;
}

/** The text a modal's input was submitted with, from either layout Discord uses (labels or action rows). */
function submitted(components: unknown, id: string): string | undefined {
  if (!components || typeof components !== "object") return undefined;
  if (Array.isArray(components)) {
    for (const c of components) {
      const found = submitted(c, id);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const c = components as { custom_id?: string; value?: string; component?: unknown; components?: unknown };
  if (c.custom_id === id && typeof c.value === "string") return c.value;
  return submitted(c.component, id) ?? submitted(c.components, id);
}

/** /sticky set|remove|pause|resume|list. */
export async function stickyCommand(env: Env, interaction: StickyInteraction): Promise<Response> {
  const guild = interaction.guild_id;
  const channel = interaction.channel_id;
  if (!guild || !channel) return privately("Use /sticky in a server channel.");
  const sub = interaction.data?.options?.[0]?.name;
  const current = await get(env, channel);

  if (sub === "set") {
    return Response.json({
      type: MODAL,
      data: {
        custom_id: MODAL_ID,
        title: current ? "Change the sticky message" : "Sticky message",
        components: [
          {
            type: 18,
            label: "Message",
            description: "Stays at the bottom of this channel. Markdown, links and emoji work; mentions don't ping.",
            component: { type: 4, custom_id: INPUT_ID, style: 2, max_length: MAX_LENGTH, required: true, ...(current ? { value: current.content } : {}) },
          },
        ],
      },
    });
  }

  if (sub === "list") {
    const { results } = await env.DB.prepare("SELECT * FROM stickies WHERE guild_id = ? ORDER BY updated_at DESC").bind(guild).all<Sticky>();
    if (!results.length) return privately("No sticky messages in this server. Use `/sticky set` in a channel to add one.");
    const line = (s: Sticky) => {
      const text = s.content.replace(/\s+/g, " ");
      return `- <#${s.channel_id}>${s.paused ? " (paused)" : ""}: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`;
    };
    return privately([`**Sticky messages** (${results.length} of ${MAX_PER_SERVER})`, ...results.map(line)].join("\n"));
  }

  if (!current) return privately("This channel has no sticky message. Use `/sticky set` to add one.");
  const http = new Http();

  if (sub === "remove") {
    await env.DB.prepare("DELETE FROM stickies WHERE channel_id = ?").bind(channel).run();
    await remove(env, http, channel, current.message_id);
    return privately("Removed this channel's sticky message.");
  }
  if (sub === "pause") {
    if (current.paused) return privately("This channel's sticky message is already paused. `/sticky resume` brings it back.");
    await env.DB.prepare("UPDATE stickies SET paused = 1 WHERE channel_id = ?").bind(channel).run();
    return privately("Paused: the sticky message stays where it is and no longer moves down. `/sticky resume` brings it back.");
  }
  if (sub === "resume") {
    if (!current.paused) return privately("This channel's sticky message isn't paused.");
    const failed = await moveDown(env, http, current);
    if (failed) return privately(cannotPost(failed));
    await env.DB.prepare("UPDATE stickies SET paused = 0 WHERE channel_id = ?").bind(channel).run();
    return privately("Resumed: the sticky message is back at the bottom of this channel.");
  }
  return privately("Unknown command.");
}

/** The modal from /sticky set: posts the message at the bottom of the channel and keeps it there. */
export async function stickySubmit(env: Env, interaction: StickyInteraction): Promise<Response> {
  const guild = interaction.guild_id;
  const channel = interaction.channel_id;
  const caller = interaction.member?.user.id;
  if (!guild || !channel || !caller || interaction.data?.custom_id !== MODAL_ID) return privately("Unknown command.");
  const content = submitted(interaction.data.components, INPUT_ID)?.trim().slice(0, MAX_LENGTH) ?? "";
  if (!content) return privately("The sticky message can't be empty.");

  const current = await get(env, channel);
  if (!current) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM stickies WHERE guild_id = ?").bind(guild).first<number>("n");
    if ((count ?? 0) >= MAX_PER_SERVER) {
      return privately(`This server already has ${MAX_PER_SERVER} sticky messages, the most it can have. Remove one with \`/sticky remove\` in its channel first.`);
    }
  }

  const http = new Http();
  const posted = await post(env, http, channel, content);
  if ("status" in posted) return privately(cannotPost(posted.status));
  await env.DB.prepare(
    `INSERT INTO stickies (channel_id, guild_id, content, message_id, paused, set_by, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET content = excluded.content, message_id = excluded.message_id, paused = 0,
       set_by = excluded.set_by, updated_at = excluded.updated_at`,
  )
    .bind(channel, guild, content, posted.id, caller, now())
    .run();
  if (current) await remove(env, http, channel, current.message_id);
  log("sticky_set", { guild, channel, by: caller });
  return privately(
    `${current ? "Updated" : "Set"} this channel's sticky message. When people post, it moves back to the bottom within about a minute.`,
  );
}

/**
 * The cron's step: moves each sticky with newer messages under it back to the bottom. A server's channels come in one
 * request with each one's latest message id; threads aren't in that list, so a sticky in a thread is looked up alone.
 */
export async function refreshStickies(ctx: Ctx): Promise<void> {
  const { env, http } = ctx;
  const { results } = await env.DB.prepare("SELECT * FROM stickies WHERE paused = 0 ORDER BY updated_at").all<Sticky>();
  const byGuild = new Map<string, Sticky[]>();
  for (const s of results) byGuild.set(s.guild_id, [...(byGuild.get(s.guild_id) ?? []), s]);
  let moves = 0;

  for (const [guild, stickies] of byGuild) {
    if (http.remaining < RESERVE) return;
    const res = await http.send("discord guild channels", `${API}/guilds/${guild}/channels`, { headers: botHeaders(env) });
    if (!res.ok) {
      // The bot was removed from the server, or Discord is down: try again next minute.
      await res.body?.cancel();
      log("sticky_guild_unreadable", { guild, status: res.status });
      continue;
    }
    const latest = new Map((await res.json<{ id: string; last_message_id?: string | null }[]>()).map((c) => [c.id, c.last_message_id ?? null]));

    for (const sticky of stickies) {
      if (moves >= MAX_MOVES_PER_RUN || http.remaining < RESERVE) return;
      let last = latest.get(sticky.channel_id);
      if (last === undefined) {
        // A thread, or a channel that was deleted.
        const thread = await http.send("discord sticky channel", `${API}/channels/${sticky.channel_id}`, { headers: botHeaders(env) });
        if (thread.status === 404) {
          await env.DB.prepare("DELETE FROM stickies WHERE channel_id = ?").bind(sticky.channel_id).run();
          log("sticky_channel_gone", { guild, channel: sticky.channel_id });
          continue;
        }
        if (!thread.ok) {
          await thread.body?.cancel();
          continue;
        }
        last = (await thread.json<{ last_message_id?: string | null }>()).last_message_id ?? null;
      }
      if (last !== null && last === sticky.message_id) continue;

      moves++;
      const failed = await moveDown(env, http, sticky);
      if (failed === 404) {
        await env.DB.prepare("DELETE FROM stickies WHERE channel_id = ?").bind(sticky.channel_id).run();
        log("sticky_channel_gone", { guild, channel: sticky.channel_id });
      } else if (failed) log("sticky_cannot_post", { guild, channel: sticky.channel_id, status: failed });
    }
  }
}
