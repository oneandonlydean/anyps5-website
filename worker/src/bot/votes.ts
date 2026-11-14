import { log, now, type Ctx, type Env } from "./env";
import {
  addCase,
  Bot,
  EPHEMERAL,
  formatDuration,
  getSetting,
  guildInfo,
  logCase,
  name,
  noticeFor,
  P,
  permissionsOf,
  privately,
  refused,
  setSetting,
  subcommand,
  text,
  topRole,
  value,
  VOTE,
  type Interaction,
  type Votes,
} from "./guild";
import { reply } from "./commands";

/**
 * Community votes, for when no moderator is around: /votekick starts a vote to ban a member for 2 weeks or silence
 * them for 24 hours. It passes at the server's number of yes votes (5 by default) with at least twice as many yes as
 * no, and fails after 10 minutes. Starting one pings the mod role, whose members can cancel it. Only members who have
 * been in the server for 2 weeks can start one or vote, and moderators can't be voted on. A passed vote is a normal
 * case, and the cron lifts the ban after 2 weeks (closeVotes). Admins set it up with /votekicks.
 */

export const VOTE_COMMANDS = new Set(["votekick", "votekicks"]);

type Action = "ban" | "timeout";

const VOTE_SECONDS = 10 * 60;
const BAN_SECONDS = 14 * 86400;
const SILENCE_SECONDS = 24 * 3600;
/** How long a member must have been in the server to start a vote or vote. */
const MEMBER_FOR = 14 * 86400;
/** After a vote on someone fails or is cancelled, how long until they can be voted on again. */
const RETRY_AFTER = 3600;
/** A banned member's messages from the last hour go with them. */
const DELETE_MESSAGES = 3600;
const MAX_REASON = 200;
const DURATION: Record<Action, number> = { ban: BAN_SECONDS, timeout: SILENCE_SECONDS };
const VERB: Record<Action, [string, string]> = { ban: ["ban", "banned"], timeout: ["silence", "silenced"] };
/** Members with any of these can't be voted on, and can cancel a vote. */
const MOD_POWERS = P.ADMINISTRATOR | P.MANAGE_GUILD | P.MANAGE_ROLES | P.BAN_MEMBERS | P.KICK_MEMBERS | P.MODERATE_MEMBERS | P.MANAGE_MESSAGES;
const COLORS = { open: 0xf0b232, passed: 0xda373c, failed: 0x80848e, cancelled: 0x80848e };
const UPDATE_MESSAGE = 7;

export interface Vote {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  target_id: string;
  target_name: string;
  action: Action;
  reason: string;
  starter_id: string;
  needed: number;
  created_at: number;
  ends_at: number;
  status: "open" | "passed" | "failed" | "cancelled";
  result: string | null;
  case_number: number | null;
  lift_at: number | null;
}

interface Count {
  yes: number;
  no: number;
}

const passes = (v: Pick<Vote, "needed">, c: Count) => c.yes >= v.needed && c.yes >= 2 * c.no;
const what = (v: Pick<Vote, "action">) => `${VERB[v.action][0]} for ${formatDuration(DURATION[v.action])}`;

async function count(env: Env, id: number): Promise<Count> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(yes), 0) AS yes, COALESCE(SUM(1 - yes), 0) AS no FROM vote_ballots WHERE vote_id = ?").bind(id).first<Count>();
  return row ?? { yes: 0, no: 0 };
}

const getVote = (env: Env, id: number) => env.DB.prepare("SELECT * FROM votes WHERE id = ?").bind(id).first<Vote>();

/** The vote message: who, why, the count, and buttons while it's open. */
export function render(v: Vote, c: Count): Record<string, unknown> {
  const open = v.status === "open";
  const lines = [
    `**Reason:** ${v.reason}`,
    `Started by <@${v.starter_id}>`,
    "",
    `**${c.yes}** for · **${c.no}** against · needs **${v.needed}** for, and twice as many for as against`,
    open ? `Ends <t:${v.ends_at}:R>` : (v.result ?? ""),
  ];
  return {
    embeds: [
      {
        title: `Vote to ${what(v)}: ${v.target_name}`,
        description: lines.join("\n"),
        color: COLORS[v.status],
        footer: { text: open ? "Members who have been here for 2 weeks can vote. A moderator can cancel it." : "Voting is over" },
      },
    ],
    components: open
      ? [
          {
            type: 1,
            components: [
              { type: 2, style: 4, label: `Yes, ${VERB[v.action][0]} them`, custom_id: `vote:${v.id}:yes` },
              { type: 2, style: 2, label: "No", custom_id: `vote:${v.id}:no` },
              { type: 2, style: 2, label: "Cancel (moderators)", custom_id: `vote:${v.id}:cancel` },
            ],
          },
        ]
      : [],
    allowed_mentions: { parse: [] },
  };
}

/** Why a member can't start a vote or vote, or undefined if they can. */
function cannotVote(member: NonNullable<Interaction["member"]>, config: Votes): string | undefined {
  if (member.user.bot) return "Bots can't vote.";
  if (member.pending) return "Accept the server's rules first.";
  const joined = member.joined_at ? Date.parse(member.joined_at) / 1000 : NaN;
  if (!(joined <= now() - MEMBER_FOR)) return "You can vote once you've been in the server for 2 weeks.";
  if (config.voterRole && !member.roles.includes(config.voterRole)) return `Only members with <@&${config.voterRole}> can vote.`;
  return undefined;
}

/** A moderator, for cancelling: a mod power in this channel, or the mod role. */
function isMod(member: NonNullable<Interaction["member"]>, config: Votes): boolean {
  const perms = BigInt(member.permissions ?? "0");
  return (perms & MOD_POWERS) !== 0n || (!!config.modRole && member.roles.includes(config.modRole));
}

// /votekick: start a vote.

async function start(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  const channel = i.channel_id;
  const member = i.member;
  if (!guild || !channel || !member) return privately("Use this in a server.");
  const config = await getSetting(env, guild, "votes");
  if (!config.enabled) return privately("Community votes are off in this server.");
  if (config.channels.length && !config.channels.includes(channel)) {
    return privately(`Votes can only be started in ${config.channels.map((c) => `<#${c}>`).join(", ")}.`);
  }
  const cannot = cannotVote(member, config);
  if (cannot) return privately(cannot.replace("You can vote", "You can start a vote"));

  const options = i.data?.options ?? [];
  const target = String(value(options, "user") ?? "");
  const action: Action = text(options, "action") === "ban" ? "ban" : "timeout";
  const reason = text(options, "reason").slice(0, MAX_REASON);
  const user = i.data?.resolved?.users?.[target];
  const targetMember = i.data?.resolved?.members?.[target];
  const who = user ? `**${name(user)}**` : `<@${target}>`;
  if (!reason) return privately("Give a reason.");
  if (!targetMember || !user) return privately(`${who} isn't in this server.`);
  if (target === member.user.id) return privately("You can't start a vote on yourself.");
  if (user.bot) return privately("Bots can't be voted on.");
  if (action === "timeout" && targetMember.communication_disabled_until && Date.parse(targetMember.communication_disabled_until) > Date.now()) {
    return privately(`${who} is already silenced.`);
  }

  const bot = new Bot(env);
  const server = await guildInfo(bot, guild);
  const modPosition = config.modRole ? (server.roles.find((r) => r.id === config.modRole)?.position ?? Infinity) : Infinity;
  if (
    target === server.owner_id ||
    (permissionsOf(server, target, targetMember.roles) & MOD_POWERS) !== 0n ||
    (config.modRole && targetMember.roles.includes(config.modRole)) ||
    topRole(server, targetMember.roles) >= modPosition
  ) {
    return privately(`${who} is a moderator, and moderators can't be voted on.`);
  }

  const t = now();
  const busy = await env.DB.prepare(
    `SELECT starter_id, target_id, status FROM votes WHERE guild_id = ?1
       AND ((status = 'open' AND (starter_id = ?2 OR target_id = ?3)) OR (target_id = ?3 AND status IN ('failed', 'cancelled') AND ends_at > ?4))
     LIMIT 1`,
  )
    .bind(guild, member.user.id, target, t - RETRY_AFTER)
    .first<Pick<Vote, "starter_id" | "target_id" | "status">>();
  if (busy?.status === "open" && busy.target_id === target) return privately(`There's already a vote on ${who}.`);
  if (busy?.status === "open") return privately("You already have a vote going. Wait for it to end.");
  if (busy) return privately(`A vote on ${who} ended in the last hour. Try again later, or ask a moderator.`);

  const vote = await env.DB.prepare(
    `INSERT INTO votes (guild_id, channel_id, target_id, target_name, action, reason, starter_id, needed, created_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(guild, channel, target, user.username, action, reason, member.user.id, config.needed, t, t + VOTE_SECONDS)
    .first<Vote>();
  await env.DB.prepare("INSERT INTO vote_ballots (vote_id, user_id, yes) VALUES (?, ?, 1)").bind(vote!.id, member.user.id).run();

  const ping = config.modRole ? { content: `<@&${config.modRole}> a community vote has started. Any moderator can cancel it.` } : {};
  const posted = await bot.post(channel, {
    ...render(vote!, { yes: 1, no: 0 }),
    ...ping,
    allowed_mentions: { parse: [], roles: config.modRole ? [config.modRole] : [] },
  });
  if ("status" in posted) {
    await env.DB.prepare("DELETE FROM votes WHERE id = ?").bind(vote!.id).run();
    return privately(refused(posted.status, "post the vote in this channel"));
  }
  await env.DB.prepare("UPDATE votes SET message_id = ? WHERE id = ?").bind(posted.id, vote!.id).run();
  log("vote_started", { guild, vote: vote!.id, action });
  return privately(`Vote started. Your vote counts as the first yes; it needs ${config.needed} within 10 minutes.`);
}

// Buttons: vote yes or no, or a moderator cancels.

export async function voteClick(env: Env, i: Interaction): Promise<Response> {
  const member = i.member;
  const guild = i.guild_id;
  if (!guild || !member) return privately("Use this in a server.");
  const [, id, choice] = (i.data?.custom_id ?? "").split(":");
  const vote = await getVote(env, Number(id));
  if (!vote || vote.guild_id !== guild) return privately("This vote is gone.");
  const update = async (v: Vote) => Response.json({ type: UPDATE_MESSAGE, data: render(v, await count(env, v.id)) });
  if (vote.status !== "open") return update(vote);
  const config = await getSetting(env, guild, "votes");

  if (choice === "cancel") {
    if (!isMod(member, config)) return privately("Only a moderator can cancel a vote.");
    const result = `Cancelled by <@${member.user.id}>.`;
    const closed = await close(env, vote, "cancelled", result);
    if (closed) log("vote_cancelled", { guild, vote: vote.id });
    return update((await getVote(env, vote.id))!);
  }

  if (now() >= vote.ends_at) {
    await expire(env, vote);
    return update((await getVote(env, vote.id))!);
  }
  if (member.user.id === vote.target_id) return privately("You can't vote on yourself.");
  const cannot = cannotVote(member, config);
  if (cannot) return privately(cannot);

  await env.DB.prepare("INSERT INTO vote_ballots (vote_id, user_id, yes) VALUES (?, ?, ?) ON CONFLICT(vote_id, user_id) DO UPDATE SET yes = excluded.yes")
    .bind(vote.id, member.user.id, choice === "yes" ? 1 : 0)
    .run();
  const c = await count(env, vote.id);
  if (passes(vote, c)) await carryOut(env, vote, c);
  return update((await getVote(env, vote.id))!);
}

/** Closes an open vote; false if something else closed it first, so only one click carries a vote out. */
async function close(env: Env, v: Vote, status: Vote["status"], result: string): Promise<boolean> {
  const res = await env.DB.prepare("UPDATE votes SET status = ?, result = ? WHERE id = ? AND status = 'open'").bind(status, result, v.id).run();
  return res.meta.changes === 1;
}

async function expire(env: Env, v: Vote): Promise<boolean> {
  const c = await count(env, v.id);
  return close(env, v, "failed", `Not enough votes: ${c.yes} for, ${c.no} against.`);
}

/** Bans or silences the member, as a case decided by the vote. */
async function carryOut(env: Env, v: Vote, c: Count): Promise<void> {
  const tally = `${c.yes} for, ${c.no} against`;
  if (!(await close(env, v, "passed", `Passed (${tally}). Carrying it out…`))) return;
  const bot = new Bot(env);
  const duration = DURATION[v.action];
  const reason = `Community vote (${tally}): ${v.reason}`;
  const server = await guildInfo(bot, v.guild_id).catch(() => undefined);
  const notice = { content: noticeFor({ action: v.action, reason, duration }, server?.name ?? "the server") };
  // Someone banned can't get a message afterwards, so they're told first.
  const toldFirst = v.action === "ban" ? await bot.dm(v.target_id, notice) : undefined;
  const status =
    v.action === "ban"
      ? await bot.status("discord ban", "PUT", `/guilds/${v.guild_id}/bans/${v.target_id}`, { delete_message_seconds: DELETE_MESSAGES }, reason)
      : await bot.status(
          "discord timeout",
          "PATCH",
          `/guilds/${v.guild_id}/members/${v.target_id}`,
          { communication_disabled_until: new Date(Date.now() + duration * 1000).toISOString() },
          reason,
        );
  if (status >= 300) {
    log("vote_action_failed", { guild: v.guild_id, vote: v.id, status });
    const failed = `Passed (${tally}), but ${refused(status, `${VERB[v.action][0]} **${v.target_name}**`).replace(/^I couldn't [^:]*: /, "I couldn't: ")}`;
    await env.DB.prepare("UPDATE votes SET result = ? WHERE id = ?").bind(failed, v.id).run();
    return;
  }
  const kase = await addCase(env, { guild_id: v.guild_id, action: v.action, user_id: v.target_id, moderator_id: VOTE, reason, duration });
  if (toldFirst === undefined) await bot.dm(v.target_id, notice);
  const done = `Passed (${tally}): **${v.target_name}** is ${VERB[v.action][1]} for ${formatDuration(duration)} (case ${kase.number}).`;
  await env.DB.prepare("UPDATE votes SET result = ?, case_number = ?, lift_at = ? WHERE id = ?")
    .bind(done, kase.number, v.action === "ban" ? now() + duration : null, v.id)
    .run();
  const { results } = await env.DB.prepare("SELECT user_id, yes FROM vote_ballots WHERE vote_id = ? ORDER BY yes DESC").bind(v.id).all<{ user_id: string; yes: number }>();
  const voters = (yes: number) => results.filter((b) => b.yes === yes).map((b) => `<@${b.user_id}>`).join(" ") || "nobody";
  await logCase(bot, kase, undefined, [
    { name: "Started by", value: `<@${v.starter_id}>` },
    { name: "Voted for", value: voters(1) },
    { name: "Voted against", value: voters(0) },
  ]);
  log("vote_passed", { guild: v.guild_id, vote: v.id, action: v.action });
}

// The cron: close votes that ran out, and lift 2-week bans.

const PER_RUN = 10;

export async function closeVotes(ctx: Ctx): Promise<void> {
  const { env } = ctx;
  const bot = new Bot(env, ctx.http);
  const t = now();
  const { results: due } = await env.DB.prepare("SELECT * FROM votes WHERE status = 'open' AND ends_at <= ? LIMIT ?").bind(t, PER_RUN).all<Vote>();
  for (const v of due) {
    if (!(await expire(env, v)) || !v.message_id) continue;
    const closed = (await getVote(env, v.id))!;
    const status = await bot.status("discord vote message", "PATCH", `/channels/${v.channel_id}/messages/${v.message_id}`, render(closed, await count(env, v.id)));
    if (status >= 300) log("vote_message_failed", { guild: v.guild_id, vote: v.id, status });
  }

  const { results: bans } = await env.DB.prepare("SELECT * FROM votes WHERE lift_at IS NOT NULL AND lift_at <= ? LIMIT ?").bind(t, PER_RUN).all<Vote>();
  for (const v of bans) {
    // A moderator banned or unbanned them since: that decision stands.
    const later = await env.DB.prepare("SELECT 1 FROM cases WHERE guild_id = ? AND user_id = ? AND action IN ('ban', 'unban') AND number > ?")
      .bind(v.guild_id, v.target_id, v.case_number ?? 0)
      .first();
    if (!later) {
      const status = await bot.status("discord unban", "DELETE", `/guilds/${v.guild_id}/bans/${v.target_id}`, undefined, "Community vote ban ended");
      if (status === 429 || status >= 500) continue; // Try again next minute.
      if (status < 300) {
        const kase = await addCase(env, { guild_id: v.guild_id, action: "unban", user_id: v.target_id, moderator_id: VOTE, reason: `The 2-week ban from case ${v.case_number} ended`, duration: null });
        await logCase(bot, kase);
      } else if (status !== 404) log("vote_unban_failed", { guild: v.guild_id, vote: v.id, status });
    }
    await env.DB.prepare("UPDATE votes SET lift_at = NULL WHERE id = ?").bind(v.id).run();
  }
}

// /votekicks: an admin turns votes on or off, picks the channels, and sees the setup.

async function setup(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  if (!guild) return privately("Use this in a server.");
  const { name: sub, options } = subcommand(i);
  const config = await getSetting(env, guild, "votes");
  if (sub === "on") {
    const modRole = String(value(options, "mod_role") ?? "") || undefined;
    const voterRole = String(value(options, "voter_role") ?? "") || undefined;
    const needed = Number(value(options, "votes") ?? config.needed);
    await setSetting(env, guild, "votes", { ...config, enabled: true, needed, modRole, voterRole });
  } else if (sub === "off") {
    await setSetting(env, guild, "votes", { ...config, enabled: false });
  } else if (sub === "channel") {
    const channel = String(value(options, "channel") ?? "");
    const channels = config.channels.includes(channel) ? config.channels.filter((c) => c !== channel) : [...config.channels, channel];
    await setSetting(env, guild, "votes", { ...config, channels });
  }
  return reply({ content: describe(await getSetting(env, guild, "votes")), flags: EPHEMERAL });
}

function describe(c: Votes): string {
  return [
    `Community votes are **${c.enabled ? "on" : "off"}**.`,
    `- Passes at **${c.needed}** yes votes, with at least twice as many yes as no, within 10 minutes`,
    `- Bans last 2 weeks; silences last 24 hours`,
    `- Mod role, pinged and able to cancel: ${c.modRole ? `<@&${c.modRole}>` : "none (members with moderation permissions can still cancel)"}`,
    `- Who can vote: members here for 2 weeks${c.voterRole ? ` with <@&${c.voterRole}>` : ""}`,
    `- Channels: ${c.channels.length ? c.channels.map((ch) => `<#${ch}>`).join(", ") : "any"}`,
  ].join("\n");
}

export function voteCommand(env: Env, i: Interaction): Promise<Response> {
  return i.data?.name === "votekicks" ? setup(env, i) : start(env, i);
}
