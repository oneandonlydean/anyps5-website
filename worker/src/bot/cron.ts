import { requestRebuild } from "../site/rebuild";
import { announceDigest, announceGames, announceReleases, classifyPull, mergeMessage, mergeWebhook, watchDiscussions } from "./announce";
import * as discord from "./discord";
import { log, makeCtx, now, type Ctx, type Env, type User } from "./env";
import * as github from "./github";
import { BudgetError, HttpError } from "./http";
import { syncUser } from "./sync";

// Workers free plan allows 50 subrequests per invocation, retries included.
// The poll announces merges until only the resync's share of the budget is
// left, so a run handles 9 merges in the worst case (author linked, token
// refreshed, count pushed) and MAX_MERGES_PER_RUN when authors are not
// linked. The cron runs every minute, so both caps are per minute.
const SUBREQUEST_BUDGET = 48;
const MERGE_COST = 4; // webhook, token refresh, search, role PUT
const USER_COST = 4; // user by id, search, token refresh, role PUT
const RESYNC_USERS_PER_RUN = 2;
// Discord allows about 30 webhook messages a minute per channel.
const MAX_MERGES_PER_RUN = 10;
// GitHub's search index trails real time, so the catch-up path leaves the most
// recent merges to a later run rather than risk seeing them out of order.
const SEARCH_LAG_MS = 5 * 60_000;
const MAX_BISECTIONS = 6;

const CURSOR_KEY = "last_merged_at";

// How often each check runs, in minutes; merges are checked every minute.
const RELEASE_EVERY = 5;
const GAMES_EVERY = 2;
const DISCUSSIONS_EVERY = 2;
const DIGEST_EVERY = 10;

type Step = [string, (ctx: Ctx) => Promise<void>];

export async function runCron(env: Env, at = new Date()): Promise<void> {
  const ctx = await makeCtx(env, SUBREQUEST_BUDGET);
  await cleanup(ctx);
  const minute = at.getUTCMinutes();
  const every = (n: number, step: Step): Step[] => (minute % n === 0 ? [step] : []);
  const steps: Step[] = [
    ...every(RELEASE_EVERY, ["releases", announceReleases]),
    ...every(GAMES_EVERY, ["games", announceGames]),
    ...every(DIGEST_EVERY, ["digest", (c) => announceDigest(c, at.toISOString().slice(0, 10))]),
    ...every(DISCUSSIONS_EVERY, ["discussions", watchDiscussions]),
    ["poll", pollMerges],
    ["resync", resync],
  ];
  // A failed step (say, a webhook is down) must not stop the others.
  for (const [name, step] of steps) {
    try {
      await step(ctx);
    } catch (err) {
      logError("cron_step_failed", err, { step: name });
      if (err instanceof BudgetError) break;
    }
  }
  // Anything that changed what the site shows (a merge, a release, new reports) rebuilds it, a few minutes behind.
  if (ctx.changes.size) {
    try {
      await requestRebuild(env, [...ctx.changes].join(", "));
    } catch (err) {
      logError("rebuild_request_failed", err);
    }
  }
  log("cron_done", { subrequests: ctx.http.used });
}

function logError(event: string, err: unknown, fields: Record<string, unknown> = {}): void {
  const error = err instanceof HttpError || err instanceof BudgetError ? err.message : String(err);
  log(event, { ...fields, error });
}

async function cleanup({ env }: Ctx): Promise<void> {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_state WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM users WHERE github_id IS NULL AND created_at < ?").bind(t - 3600),
  ]);
}

const cursorStatement = ({ env }: Ctx, value: string) =>
  env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(
    CURSOR_KEY,
    value,
  );

async function setCursor(ctx: Ctx, value: string): Promise<void> {
  await cursorStatement(ctx, value).run();
}

/** Stores a merge in the history table and moves the cursor past it, atomically. */
async function recordMerge(ctx: Ctx, pr: github.Pull): Promise<void> {
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      "INSERT OR REPLACE INTO merges (number, title, author_id, author_login, merged_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(pr.number, pr.title, pr.user?.id ?? null, pr.user?.login ?? "ghost", pr.merged_at),
    cursorStatement(ctx, pr.merged_at),
  ]);
}

const isBot = (pr: github.Pull) => pr.user?.login.endsWith("[bot]") ?? false;

const sort = (prs: github.Pull[]) => prs.sort((a, b) => Date.parse(a.merged_at) - Date.parse(b.merged_at));
const after = (prs: github.Pull[], cursor: number) => sort(prs.filter((pr) => Date.parse(pr.merged_at) > cursor));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + "Z";

/**
 * Merged PRs newer than the cursor, oldest first. May return only the oldest
 * part of a large backlog; the rest follows on later runs.
 */
async function mergedSince(ctx: Ctx, cursor: number): Promise<github.Pull[]> {
  const { pulls, more } = await github.recentMerged(ctx);
  // Sorted by updated_at, and a PR is never merged after its last update, so
  // once the list reaches back to the cursor it holds every merge since.
  if (!more || pulls.some((pr) => Date.parse(pr.updated_at) <= cursor)) return after(pulls, cursor);
  return backlogSince(ctx, cursor);
}

/**
 * Catch-up path for when more has happened since the cursor than one list
 * page shows. Searches by merge time, shrinking the window from the cursor
 * until it holds few enough merges to see them all, so none are skipped.
 */
async function backlogSince(ctx: Ctx, cursor: number): Promise<github.Pull[]> {
  const probe = async (end: number) => {
    const { pulls, total } = await github.mergedBetween(ctx, iso(cursor), iso(end));
    return { complete: total <= pulls.length, merged: after(pulls, cursor) };
  };

  let hi = Date.now() - SEARCH_LAG_MS;
  if (hi <= cursor) return [];
  let result = await probe(hi);
  if (result.complete) return result.merged;

  let lo = cursor;
  for (let i = 0; i < MAX_BISECTIONS; i++) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const half = await probe(mid);
    if (half.complete && half.merged.length) return half.merged;
    if (half.complete) lo = mid;
    else {
      hi = mid;
      result = half;
    }
  }
  log("backlog_window_overfull", { from: iso(cursor), to: iso(hi) });
  return result.merged;
}

export async function pollMerges(ctx: Ctx): Promise<void> {
  const { env } = ctx;
  const stored = await env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(CURSOR_KEY).first<string>("value");
  if (stored === null) {
    // First run: start from now so the backlog is never announced.
    await setCursor(ctx, new Date().toISOString());
    return;
  }

  const merged = await mergedSince(ctx, Date.parse(stored));
  let announced = 0;
  let last: string | undefined;
  for (const pr of merged) {
    // Stop at the cap, but never between two PRs with the same merged_at: the
    // cursor could not tell them apart and the second would be lost.
    const full =
      announced >= MAX_MERGES_PER_RUN || ctx.http.remaining < MERGE_COST + RESYNC_USERS_PER_RUN * USER_COST;
    if (full && pr.merged_at !== last) break;
    last = pr.merged_at;

    // Already in the history, so already announced (or deliberately
    // backfilled). This makes rewinding the cursor safe: no duplicates.
    if (await env.DB.prepare("SELECT 1 FROM merges WHERE number = ?").bind(pr.number).first()) {
      await setCursor(ctx, last);
      continue;
    }

    if (isBot(pr)) {
      await recordMerge(ctx, pr);
      continue;
    }

    const author = pr.user?.id
      ? await env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(pr.user.id).first<User>()
      : null;
    const merge = classifyPull(pr, env);
    const webhook = mergeWebhook(env, merge);
    if (webhook) {
      // If this throws, the cursor stays behind this PR and it is retried next run.
      await discord.postWebhook(ctx, "discord webhook", webhook, mergeMessage(env, pr, merge, author?.discord_id));
      announced++;
      log("merge_announced", { pr: pr.number, area: merge.area });
    }
    await recordMerge(ctx, pr);
    if (merge.notable) ctx.changes.add("merge");

    if (author) {
      try {
        await syncUser(ctx, author, pr.user!.login);
      } catch (err) {
        if (err instanceof BudgetError) throw err;
        // The rolling resync will pick this user up.
        logError("author_sync_failed", err, { discord_id: author.discord_id });
      }
    }
  }
}

export async function resync(ctx: Ctx): Promise<void> {
  const { env } = ctx;
  const { results } = await env.DB.prepare(
    "SELECT * FROM users WHERE github_id IS NOT NULL ORDER BY synced_at LIMIT ?",
  )
    .bind(RESYNC_USERS_PER_RUN)
    .all<User>();

  for (const user of results) {
    try {
      await syncUser(ctx, user);
    } catch (err) {
      if (err instanceof BudgetError) throw err;
      logError("resync_failed", err, { discord_id: user.discord_id });
      // Move a failing user to the back so they cannot block the queue.
      await env.DB.prepare("UPDATE users SET synced_at = ? WHERE discord_id = ?").bind(now(), user.discord_id).run();
    }
  }
}
