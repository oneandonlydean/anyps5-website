import type { Job } from "./events";
import { addCase, logCase, noticeFor, type Bot, type Case } from "./guild";
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
    case "punish": {
      const duration = job.action === "timeout" ? job.minutes * 60 : null;
      if (job.action === "timeout") {
        const until = new Date(Date.now() + duration! * 1000).toISOString();
        const status = await bot.status("discord timeout", "PATCH", `/guilds/${job.guild}/members/${job.user.id}`, { communication_disabled_until: until }, job.reason);
        check("discord timeout", status);
        if (status >= 300) return [];
      }
      const c = await addCase(bot.env, { guild_id: job.guild, action: job.action, user_id: job.user.id, moderator_id: bot.env.DISCORD_CLIENT_ID, reason: job.reason, duration });
      await bot.dm(job.user.id, { content: noticeFor(c, job.server) });
      await logCase(bot, c, job.user);
      return [];
    }
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
