import type { Env } from "../bot/env";
import { log } from "../bot/env";
import { nowSeconds } from "./http";

/** At most one rebuild request per this many seconds; a build already under way picks up later changes too. */
const DEBOUNCE = 120;

/**
 * Asks the site repository to rebuild and redeploy (its "Update site" workflow listens for this event), so new
 * uploads and maintainer actions reach the static pages within minutes. Does nothing where no token is configured.
 */
export async function requestRebuild(env: Env, reason: string): Promise<void> {
  if (!env.SITE_DISPATCH_TOKEN || !env.SITE_REPO || !env.SITE_DB) return;
  const last = Number(await env.SITE_DB.prepare("SELECT value FROM site_kv WHERE key = 'rebuild_at'").first<string>("value")) || 0;
  if (nowSeconds() - last < DEBOUNCE) return;
  await env.SITE_DB.prepare("INSERT INTO site_kv (key, value) VALUES ('rebuild_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String(nowSeconds()))
    .run();
  const res = await fetch(`https://api.github.com/repos/${env.SITE_REPO}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.SITE_DISPATCH_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "anyps5-website" },
    body: JSON.stringify({ event_type: "site-data-changed", client_payload: { reason } }),
  });
  log("rebuild_requested", { reason, status: res.status });
}
