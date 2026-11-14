import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch(["users", "oauth_state", "kv", "merges", "stickies"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await applyD1Migrations(env.SITE_DB!, env.TEST_SITE_MIGRATIONS);
  await env.SITE_DB!.batch(
    ["accounts", "sessions", "login_state", "uploads", "hidden", "moderation_log", "site_kv"].map((t) => env.SITE_DB!.prepare(`DELETE FROM ${t}`)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
