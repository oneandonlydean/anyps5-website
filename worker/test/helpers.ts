import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { encrypt, importKey } from "../src/bot/crypto";
import type { User } from "../src/bot/env";

export interface Call {
  method: string;
  url: string;
  body: string;
  auth: string | null;
}

type Handler = (call: Call) => Response;

/**
 * Stubs global fetch. Routes are matched by "METHOD url-prefix", first match
 * wins; an unmatched request fails the test. Returns the recorded calls.
 */
export function mockFetch(routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const call = { method: req.method, url: req.url, body: new TextDecoder().decode(await req.arrayBuffer()), auth: req.headers.get("authorization") };
    calls.push(call);
    for (const [key, handler] of Object.entries(routes)) {
      const [method, prefix] = key.split(" ");
      if (method === call.method && call.url.startsWith(prefix!)) return handler(call);
    }
    throw new Error(`unexpected fetch: ${call.method} ${call.url}`);
  });
  return calls;
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const WEBHOOK = "POST https://discord.com/api/webhooks/";
export const SEARCH = "GET https://api.github.com/search/issues";
export const PULLS = "POST https://api.github.com/graphql";
export const ROLE = "PUT https://discord.com/api/v10/users/@me/applications/app123/role-connection";
export const DISCORD_TOKEN = "POST https://discord.com/api/v10/oauth2/token";

/** A merged PR as the GraphQL API returns it. A login ending in "[bot]" becomes a Bot author. */
export function pull(number: number, mergedAt: string, login = "alice", id = 1) {
  const bot = login.endsWith("[bot]");
  return {
    number,
    title: `fix(libkernel): PR ${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    updatedAt: mergedAt,
    mergedAt,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    author: {
      __typename: bot ? "Bot" : "User",
      login: login.replace("[bot]", ""),
      url: `https://github.com/${login}`,
      avatarUrl: `https://avatars.test/${id}`,
      databaseId: id,
    },
    mergedBy: { login: "maintainer" },
    labels: { nodes: [] as { name: string }[] },
  };
}

/** The GraphQL list of recently updated merged PRs. `more` means older ones exist beyond it. */
export const pulls = (nodes: ReturnType<typeof pull>[], more = false) =>
  Response.json({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: more }, nodes } } } });

/** A GraphQL search result: `total` matches, of which `nodes` are returned. */
export const found = (nodes: ReturnType<typeof pull>[], total = nodes.length) =>
  Response.json({ data: { search: { issueCount: total, nodes } } });

export async function addUser(overrides: Partial<User> & { discord_id: string }): Promise<void> {
  const key = await importKey(env.TOKEN_KEY);
  const t = Math.floor(Date.now() / 1000);
  const u: User = {
    github_id: 1,
    github_login: "alice",
    merged_prs: 0,
    access_token_enc: await encrypt(key, `access-${overrides.discord_id}`),
    refresh_token_enc: await encrypt(key, `refresh-${overrides.discord_id}`),
    token_expires_at: t + 7 * 86400,
    synced_at: 0,
    created_at: t,
    ...overrides,
  };
  await env.DB.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(u.discord_id, u.github_id, u.github_login, u.merged_prs, u.access_token_enc, u.refresh_token_enc, u.token_expires_at, u.synced_at, u.created_at)
    .run();
}

export const getUser = (discordId: string) =>
  env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discordId).first<User>();

export const setCursor = (value: string) =>
  env.DB.prepare("INSERT OR REPLACE INTO kv VALUES ('last_merged_at', ?)").bind(value).run();

export const getCursor = () =>
  env.DB.prepare("SELECT value FROM kv WHERE key = 'last_merged_at'").first<string>("value");
