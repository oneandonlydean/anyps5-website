import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch(["users", "oauth_state", "kv", "merges"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
