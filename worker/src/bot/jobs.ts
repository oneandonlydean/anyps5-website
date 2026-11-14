import type { Job } from "./events";
import { addCase, formatDuration, logCase, noticeFor, type Bot, type Case } from "./guild";
import { HttpError } from "./http";
import { moveStickyIfBuried } from "./sticky";

/**
 * Runs the jobs the gateway queues (events.ts). A job that throws is retried; one Discord refuses for good (no
 * permission, a deleted channel) is dropped, since retrying can't help. Returns any follow-up jobs, like deleting a
 * notice again a few seconds later.
 */

const AUDIT_BAN = 22;
const AUDIT_UNBAN = 23;
/** A ban the bot made itself is already a case; one this recent is taken to be it. */
const OWN_CASE_SECONDS = 120;

/** A burst of rule-breaking messages is one strike: another within this long only deletes. */
const STRIKE_COOLDOWN = 120;
/** A ban clears this much of their recent messages. */
const BAN_CLEARS = 3600;

/** 4xx other than rate limits won't change on a retry. */
const final = (status: number) => status >= 400 && status < 500 && status !== 429;

function check(label: string, status: number): void {
  if (status < 300 || final(status)) return;
  throw new HttpError(label, status);
}

export async function runJob(bot: Bot, job: Job): Promise<{ job: Job; delay: number }[]> {
  switch (job.kind) {
    case "post": {
      const posted = await bot.post(job.channel, job.message);
      if ("status" in posted) check("discord post", posted.status);
      if ("id" in posted && job.expires) {
        return [{ job: { kind: "delete", channel: job.channel, message: posted.id, reason: "Automod notice" }, delay: job.expires }];
      }
      return [];
    }
    case "delete": {
      const status = await bot.status("discord delete", "DELETE", `/channels/${job.channel}/messages/${job.message}`, undefined, job.reason);
      check("discord delete", status);
      return [];
    }
    case "role": {
      const status = await bot.status("discord member role", "PUT", `/guilds/${job.guild}/members/${job.user}/roles/${job.role}`, undefined, job.reason);
      check("discord member role", status);
      return [];
    }
    case "strike":
      return strike(bot, job);
    case "sticky":
      await moveStickyIfBuried(bot, job.channel);
      return [];
    case "ban": {
      const action = job.banned ? "ban" : "unban";
      const since = Math.floor(Date.now() / 1000) - OWN_CASE_SECONDS;
      const own = await bot.env.DB.prepare("SELECT 1 FROM cases WHERE guild_id = ? AND user_id = ? AND action = ? AND created_at >= ?")
        .bind(job.guild, job.user.id, action, since)
        .first();
      if (own) return [];
      // Banned from Discord's own menu or by another bot: the audit log says who did it and why.
      const res = await bot.call("discord audit log", "GET", `/guilds/${job.guild}/audit-logs?action_type=${job.banned ? AUDIT_BAN : AUDIT_UNBAN}&limit=10`);
      let moderator = "0";
      let reason: string | null = null;
      if (res.ok) {
        const { audit_log_entries } = await res.json<{ audit_log_entries: { target_id: string; user_id: string; reason?: string }[] }>();
        const entry = audit_log_entries.find((e) => e.target_id === job.user.id);
        if (entry) {
          moderator = entry.user_id;
          reason = entry.reason ?? null;
        }
      } else await res.body?.cancel();
      const c: Case = await addCase(bot.env, { guild_id: job.guild, action, user_id: job.user.id, moderator_id: moderator, reason, duration: null });
      await logCase(bot, c, job.user);
      return [];
    }
  }
}

/**
 * One step on the warning ladder: a public warning in the channel (only ever one), then a timeout, then a ban. Earlier
 * warnings and timeouts count, whoever gave them; /unwarn takes one back. Severe cases (hacked accounts, phishing) skip
 * the warning.
 */
async function strike(bot: Bot, job: Extract<Job, { kind: "strike" }>): Promise<{ job: Job; delay: number }[]> {
  const { env } = bot;
  const now = Math.floor(Date.now() / 1000);
  const latest = await env.DB.prepare("SELECT MAX(created_at) AS at FROM cases WHERE guild_id = ? AND user_id = ? AND action IN ('warn', 'timeout', 'ban')")
    .bind(job.guild, job.user.id)
    .first<number | null>("at");
  if (latest && now - latest < STRIKE_COOLDOWN) return [];
  const { results } = await env.DB.prepare("SELECT action FROM cases WHERE guild_id = ? AND user_id = ? AND active = 1 AND action IN ('warn', 'timeout')")
    .bind(job.guild, job.user.id)
    .all<{ action: string }>();
  const warned = results.some((c) => c.action === "warn");
  const timedOut = results.some((c) => c.action === "timeout");
  const step: Case["action"] = timedOut ? "ban" : warned || job.severe ? "timeout" : "warn";

  const who = `<@${job.user.id}>`;
  const rules = job.rules ? `<#${job.rules}>` : "the server rules";
  const reason = `Automod (${job.filter}): ${job.why}`;
  const length = formatDuration(job.minutes * 60);
  const say = (content: string) => bot.post(job.channel, { content, allowed_mentions: { users: [job.user.id] } });

  if (step === "warn") {
    const c = await addCase(env, { guild_id: job.guild, action: "warn", user_id: job.user.id, moderator_id: env.DISCORD_CLIENT_ID, reason, duration: null });
    await say(`⚠️ ${who}, your message was removed: ${job.why}.\nThis is your only warning. Next time is a ${length} timeout, and after that a ban. Please read ${rules}.`);
    await logCase(bot, c, job.user);
    return [];
  }

  if (step === "timeout") {
    const until = new Date(Date.now() + job.minutes * 60_000).toISOString();
    const status = await bot.status("discord timeout", "PATCH", `/guilds/${job.guild}/members/${job.user.id}`, { communication_disabled_until: until }, reason);
    check("discord timeout", status);
    if (status >= 300) return [];
    const c = await addCase(env, { guild_id: job.guild, action: "timeout", user_id: job.user.id, moderator_id: env.DISCORD_CLIENT_ID, reason, duration: job.minutes * 60 });
    const before = warned ? "They had been warned. " : "";
    await say(`🔇 ${who} was timed out for ${length}: ${job.why}. ${before}Next time is a ban. Please read ${rules}.`);
    await bot.dm(job.user.id, { content: `${noticeFor(c, job.server)}\nNext time is a ban.` });
    await logCase(bot, c, job.user);
    return [];
  }

  // Told first: once banned, a direct message can't reach them.
  await bot.dm(job.user.id, { content: noticeFor({ action: "ban", reason, duration: null }, job.server) });
  const status = await bot.status("discord ban", "PUT", `/guilds/${job.guild}/bans/${job.user.id}`, { delete_message_seconds: BAN_CLEARS }, reason);
  check("discord ban", status);
  if (status >= 300) return [];
  const c = await addCase(env, { guild_id: job.guild, action: "ban", user_id: job.user.id, moderator_id: env.DISCORD_CLIENT_ID, reason, duration: null });
  await say(`🔨 ${who} was banned: ${job.why}, after ${warned ? "a warning and a timeout" : "a timeout"}.`);
  await logCase(bot, c, job.user);
  return [];
}
