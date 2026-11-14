import type { Env } from "./env";
import {
  addCase,
  Bot,
  caseLine,
  formatDuration,
  guildInfo,
  logCase,
  noticeFor,
  P,
  parseDuration,
  privately,
  refused,
  text,
  topRole,
  value,
  type Case,
  type Interaction,
  type Option,
} from "./guild";

/**
 * Moderation commands, as Carl-bot had them: /ban, /unban, /kick, /timeout, /untimeout, /warn, /warnings, /unwarn,
 * /purge, /slowmode, /lock and /unlock. Discord decides who can run each one (default_member_permissions in
 * scripts/commands.mjs); this checks that a moderator only acts on members below them, records a numbered case, tells
 * the member by direct message, and posts the case to the server's moderation log.
 */

export const MODERATION = new Set(["ban", "unban", "kick", "timeout", "untimeout", "warn", "warnings", "unwarn", "purge", "slowmode", "lock", "unlock"]);

const MAX_TIMEOUT = 28 * 86400;
/** Discord only bulk-deletes messages younger than 14 days. */
const BULK_AGE_MS = 14 * 86400_000 - 60_000;
const LOCKED = P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS | P.CREATE_PUBLIC_THREADS | P.CREATE_PRIVATE_THREADS;
const WARNINGS_SHOWN = 15;

/** Discord's snowflake ids carry their creation time. */
const createdAt = (id: string) => Number(BigInt(id) >> 22n) + 1420070400000;

type Act = "ban" | "kick" | "timeout" | "untimeout" | "warn";
const PAST: Record<Act, string> = { ban: "Banned", kick: "Kicked", timeout: "Timed out", untimeout: "Lifted the timeout on", warn: "Warned" };
const INFINITIVE: Record<Act, string> = { ban: "ban", kick: "kick", timeout: "time out", untimeout: "lift the timeout on", warn: "warn" };

export async function moderation(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  const caller = i.member?.user.id;
  const name = i.data?.name ?? "";
  if (!guild || !caller || !i.member) return privately("Use this in a server.");
  const options = i.data?.options ?? [];
  const bot = new Bot(env);

  switch (name) {
    case "ban":
    case "kick":
    case "timeout":
    case "untimeout":
    case "warn":
      return act(bot, i, guild, caller, name, options);
    case "unban":
      return unban(bot, guild, caller, options);
    case "warnings":
      return warnings(env, guild, options);
    case "unwarn":
      return unwarn(env, guild, options);
    case "purge":
      return purge(bot, i, options);
    case "slowmode":
      return slowmode(bot, i, options);
    case "lock":
    case "unlock":
      return lock(bot, i, guild, name === "lock", options);
  }
  return privately("Unknown command.");
}

async function act(bot: Bot, i: Interaction, guild: string, caller: string, action: Act, options: Option[]): Promise<Response> {
  const target = String(value(options, "user") ?? "");
  const user = i.data?.resolved?.users?.[target];
  const member = i.data?.resolved?.members?.[target];
  const reason = text(options, "reason") || null;
  const who = user ? `**${user.username}**` : `<@${target}>`;

  if (!target) return privately("Pick a member.");
  if (target === caller) return privately(`You can't ${INFINITIVE[action]} yourself.`);
  if (target === bot.env.DISCORD_CLIENT_ID) return privately(`I can't ${INFINITIVE[action]} myself.`);
  if (!member && action !== "ban") return privately(`${who} isn't in this server.`);

  let duration: number | null = null;
  if (action === "timeout") {
    duration = parseDuration(text(options, "duration")) ?? null;
    if (!duration) return privately("Give the duration like `10m`, `1h`, `2d` or `1w`.");
    if (duration > MAX_TIMEOUT) return privately("Discord allows timeouts of up to 28 days.");
  }

  const server = await guildInfo(bot, guild);
  if (member) {
    if (target === server.owner_id) return privately(`You can't ${INFINITIVE[action]} the server owner.`);
    if (caller !== server.owner_id && topRole(server, i.member!.roles) <= topRole(server, member.roles)) {
      return privately(`You can't ${INFINITIVE[action]} ${who}: their highest role is the same as or above yours.`);
    }
  }

  // A member who's kicked or banned can't get a message afterwards, so they're told first.
  const notice = { content: noticeFor({ action, reason, duration }, server.name) };
  const toldFirst = member && (action === "ban" || action === "kick") ? await bot.dm(target, notice) : undefined;

  const audit = `${reason ?? "No reason given"} (by ${i.member!.user.username})`;
  let status = 204;
  if (action === "ban") {
    const seconds = Number(value(options, "delete_messages") ?? 0);
    status = await bot.status("discord ban", "PUT", `/guilds/${guild}/bans/${target}`, { delete_message_seconds: seconds }, audit);
  } else if (action === "kick") {
    status = await bot.status("discord kick", "DELETE", `/guilds/${guild}/members/${target}`, undefined, audit);
  } else if (action === "timeout" || action === "untimeout") {
    const until = action === "timeout" ? new Date(Date.now() + duration! * 1000).toISOString() : null;
    status = await bot.status("discord timeout", "PATCH", `/guilds/${guild}/members/${target}`, { communication_disabled_until: until }, audit);
  }
  if (status >= 300) return privately(refused(status, `${INFINITIVE[action]} ${who}`));

  const c = await addCase(bot.env, { guild_id: guild, action, user_id: target, moderator_id: caller, reason, duration });
  const told = toldFirst ?? (await bot.dm(target, notice));
  await logCase(bot, c, user);
  return privately(
    `${PAST[action]} ${who}${duration ? ` for ${formatDuration(duration)}` : ""} (case ${c.number}). ${told ? "They were told by direct message." : "They don't accept direct messages, so they weren't told."}`,
  );
}

async function unban(bot: Bot, guild: string, caller: string, options: Option[]): Promise<Response> {
  const target = String(value(options, "user") ?? "");
  const reason = text(options, "reason") || null;
  const status = await bot.status("discord unban", "DELETE", `/guilds/${guild}/bans/${target}`, undefined, reason ?? undefined);
  if (status === 404) return privately(`<@${target}> isn't banned.`);
  if (status >= 300) return privately(refused(status, `unban <@${target}>`));
  const c = await addCase(bot.env, { guild_id: guild, action: "unban", user_id: target, moderator_id: caller, reason, duration: null });
  await logCase(bot, c);
  return privately(`Unbanned <@${target}> (case ${c.number}).`);
}

async function warnings(env: Env, guild: string, options: Option[]): Promise<Response> {
  const target = String(value(options, "user") ?? "");
  const { results } = await env.DB.prepare("SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY number DESC").bind(guild, target).all<Case>();
  if (!results.length) return privately(`<@${target}> has a clean record.`);
  const warns = results.filter((c) => c.action === "warn" && c.active).length;
  const shown = results.slice(0, WARNINGS_SHOWN).map((c) => caseLine(c, env.DISCORD_CLIENT_ID));
  return privately(
    [
      `<@${target}>: **${warns}** active warning${warns === 1 ? "" : "s"}, ${results.length} case${results.length === 1 ? "" : "s"} in all.`,
      ...shown,
      ...(results.length > WARNINGS_SHOWN ? [`…and ${results.length - WARNINGS_SHOWN} older.`] : []),
    ].join("\n"),
  );
}

async function unwarn(env: Env, guild: string, options: Option[]): Promise<Response> {
  const number = Number(value(options, "case"));
  const c = await env.DB.prepare("SELECT * FROM cases WHERE guild_id = ? AND number = ?").bind(guild, number).first<Case>();
  if (!c) return privately(`There's no case ${number}.`);
  if (c.action !== "warn") return privately(`Case ${number} is a ${c.action}, not a warning.`);
  if (!c.active) return privately(`Case ${number} was already taken back.`);
  await env.DB.prepare("UPDATE cases SET active = 0 WHERE guild_id = ? AND number = ?").bind(guild, number).run();
  return privately(`Took back warning ${number} for <@${c.user_id}>.`);
}

async function purge(bot: Bot, i: Interaction, options: Option[]): Promise<Response> {
  const channel = i.channel_id!;
  const count = Math.min(100, Math.max(1, Number(value(options, "count") ?? 0)));
  const from = String(value(options, "user") ?? "");
  const res = await bot.call("discord messages", "GET", `/channels/${channel}/messages?limit=100`);
  if (!res.ok) {
    await res.body?.cancel();
    return privately(refused(res.status, "read this channel"));
  }
  const recent = await res.json<{ id: string; author: { id: string }; pinned?: boolean }[]>();
  const matching = recent.filter((m) => !m.pinned && (!from || m.author.id === from)).slice(0, count);
  const young = matching.filter((m) => Date.now() - createdAt(m.id) < BULK_AGE_MS).map((m) => m.id);
  const old = matching.length - young.length;
  if (!young.length) return privately(old ? "Those messages are older than 14 days, which Discord won't bulk delete." : "No messages to delete.");

  const reason = `Purge by ${i.member!.user.username}`;
  const status =
    young.length === 1
      ? await bot.status("discord delete", "DELETE", `/channels/${channel}/messages/${young[0]}`, undefined, reason)
      : await bot.status("discord bulk delete", "POST", `/channels/${channel}/messages/bulk-delete`, { messages: young }, reason);
  if (status >= 300) return privately(refused(status, "delete messages here"));
  return privately(
    `Deleted ${young.length} message${young.length === 1 ? "" : "s"}${from ? ` from <@${from}>` : ""}.${old ? ` ${old} older than 14 days were left, since Discord won't bulk delete them.` : ""} Pinned messages are never deleted.`,
  );
}

async function slowmode(bot: Bot, i: Interaction, options: Option[]): Promise<Response> {
  const channel = String(value(options, "channel") ?? i.channel_id);
  const seconds = Number(value(options, "seconds") ?? 0);
  const status = await bot.status("discord slowmode", "PATCH", `/channels/${channel}`, { rate_limit_per_user: seconds }, `Slowmode by ${i.member!.user.username}`);
  if (status >= 300) return privately(refused(status, "change the slowmode there"));
  return privately(seconds ? `Slowmode in <#${channel}> is now ${formatDuration(seconds)}.` : `Turned off slowmode in <#${channel}>.`);
}

interface Overwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

async function lock(bot: Bot, i: Interaction, guild: string, locking: boolean, options: Option[]): Promise<Response> {
  const channel = String(value(options, "channel") ?? i.channel_id);
  const reason = text(options, "reason");
  const res = await bot.call("discord channel", "GET", `/channels/${channel}`);
  if (!res.ok) {
    await res.body?.cancel();
    return privately(refused(res.status, "read that channel"));
  }
  const { permission_overwrites = [] } = await res.json<{ permission_overwrites?: Overwrite[] }>();
  const everyone = permission_overwrites.find((o) => o.id === guild) ?? { id: guild, type: 0, allow: "0", deny: "0" };
  let allow = BigInt(everyone.allow);
  let deny = BigInt(everyone.deny);
  if (locking === Boolean(deny & P.SEND_MESSAGES)) return privately(`<#${channel}> is already ${locking ? "locked" : "unlocked"}.`);
  if (locking) {
    allow &= ~LOCKED;
    deny |= LOCKED;
  } else deny &= ~LOCKED;

  // Posted before locking, since afterwards the bot may not be able to post there either.
  const notice = { content: `${locking ? "🔒 This channel is locked." : "🔓 This channel is unlocked."}${reason ? ` ${reason}` : ""}` };
  if (locking) await bot.post(channel, notice);
  const status = await bot.status(
    "discord overwrite",
    "PUT",
    `/channels/${channel}/permissions/${guild}`,
    { type: 0, allow: allow.toString(), deny: deny.toString() },
    `${locking ? "Lock" : "Unlock"} by ${i.member!.user.username}`,
  );
  if (status >= 300) return privately(refused(status, `${locking ? "lock" : "unlock"} that channel`));
  if (!locking) await bot.post(channel, notice);
  return privately(
    locking ? `Locked <#${channel}>. Administrators and roles allowed to send there can still post. \`/unlock\` opens it again.` : `Unlocked <#${channel}>.`,
  );
}
