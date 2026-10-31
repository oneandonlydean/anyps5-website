import type { Env } from "../bot/env";
import { log } from "../bot/env";
import { nowSeconds } from "./http";

/** At most one rebuild request per this many seconds; a build already under way picks up later changes too. */
const DEBOUNCE = 120;

/**
 * Asks the site repository to rebuild and redeploy (its "Update site" workflow listens for this event), so new
 * uploads, maintainer actions and upstream changes reach the static pages within minutes. Within two minutes of the
 * last request, the request is kept as pending instead and sent by a later call or by the bot's next minute, so a
 * change that lands after a build has already read its data is never dropped. Does nothing without a token.
 */
export async function requestRebuild(env: Env, reason: string): Promise<void> {
  if (!env.SITE_DISPATCH_TOKEN || !env.SITE_REPO || !env.SITE_DB) return;
  const db = env.SITE_DB;
  const last = Number(await db.prepare("SELECT value FROM site_kv WHERE key = 'rebuild_at'").first<string>("value")) || 0;
  if (nowSeconds() - last < DEBOUNCE) {
    await setKv(db, "rebuild_pending", reason);
    return;
  }
  const res = await dispatch(env, "site-data-changed", reason);
  // Only a request GitHub accepted starts the quiet period; a failed one stays pending and is retried.
  if (res.ok) {
    await setKv(db, "rebuild_at", String(nowSeconds()));
    await db.prepare("DELETE FROM site_kv WHERE key = 'rebuild_pending'").run();
  } else await setKv(db, "rebuild_pending", reason);
}

function dispatch(env: Env, eventType: string, reason: string): Promise<Response> {
  return fetch(`https://api.github.com/repos/${env.SITE_REPO}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.SITE_DISPATCH_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "anyps5-website" },
    body: JSON.stringify({ event_type: eventType, client_payload: { reason } }),
  }).then((res) => {
    log("rebuild_requested", { event: eventType, reason, status: res.status });
    return res;
  });
}

/**
 * The site's part of the Worker's minute: sends held-back rebuild requests, and every SITE_REFRESH_MINUTES asks the
 * site repository to check upstream. GitHub's own schedule runs late or not at all; this keeps the site within that
 * many minutes of upstream. The workflow rebuilds only when something the site shows has changed.
 */
export async function siteCron(env: Env, now: Date): Promise<void> {
  await flushPendingRebuild(env);
  const every = Number(env.SITE_REFRESH_MINUTES);
  if (!env.SITE_DISPATCH_TOKEN || !env.SITE_REPO || !(every > 0)) return;
  if (Math.floor(now.getTime() / 60_000) % every === 0) await dispatch(env, "scheduled-check", `every ${every} minutes`);
}

/** Sends a rebuild request that was held back by the quiet period, once it has passed. */
export async function flushPendingRebuild(env: Env): Promise<void> {
  if (!env.SITE_DB) return;
  const pending = await env.SITE_DB.prepare("SELECT value FROM site_kv WHERE key = 'rebuild_pending'").first<string>("value");
  if (pending) await requestRebuild(env, pending);
}

const setKv = (db: D1Database, key: string, value: string) =>
  db.prepare("INSERT INTO site_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
