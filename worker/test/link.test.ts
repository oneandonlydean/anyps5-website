import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { decrypt, importKey } from "../src/bot/crypto";
import worker from "../src/index";
import { DISCORD_TOKEN, ROLE, SEARCH, getUser, json, mockFetch, type Call } from "./helpers";

const get = (path: string, cookie?: string) =>
  worker.fetch(new Request(`https://worker.test${path}`, { headers: cookie ? { cookie } : {} }) as any, env);

const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;
const stateOf = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("state")!;

/** Fake Discord + GitHub for one person: Discord user `discordId`, GitHub user `gh`. */
function providers(discordId: string, gh: { id: number; login: string }, mergedPrs: number): Call[] {
  return mockFetch({
    [DISCORD_TOKEN]: () => json({ access_token: `at-${discordId}`, refresh_token: `rt-${discordId}`, expires_in: 604800 }),
    "GET https://discord.com/api/v10/users/@me": () => json({ id: discordId }),
    "POST https://github.com/login/oauth/access_token": () => json({ access_token: "gh-user-token" }),
    "GET https://api.github.com/user": () => json(gh),
    [SEARCH]: () => json({ total_count: mergedPrs, incomplete_results: false }),
    [ROLE]: () => json({}),
  });
}

async function link(): Promise<Response> {
  const start = await get("/linked-role");
  const mid = await get(`/discord/callback?code=dc&state=${stateOf(start)}`, cookieOf(start));
  expect(mid.status).toBe(302);
  expect(mid.headers.get("location")).toContain("https://github.com/login/oauth/authorize");
  return get(`/github/callback?code=gc&state=${stateOf(mid)}`, cookieOf(mid));
}

it("redirects to Discord with a state bound by cookie", async () => {
  const res = await get("/linked-role");
  const to = new URL(res.headers.get("location")!);
  expect(res.status).toBe(302);
  expect(to.origin + to.pathname).toBe("https://discord.com/oauth2/authorize");
  expect(to.searchParams.get("scope")).toBe("identify role_connections.write");
  expect(to.searchParams.get("redirect_uri")).toBe("https://worker.test/discord/callback");
  expect(res.headers.get("set-cookie")).toMatch(/Secure; HttpOnly; SameSite=Lax/);
});

it("links an account, stores encrypted tokens and pushes the count", async () => {
  const calls = providers("d1", { id: 42, login: "alice" }, 7);
  const res = await link();
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("7 merged pull requests");

  const user = (await getUser("d1"))!;
  expect(user).toMatchObject({ github_id: 42, github_login: "alice", merged_prs: 7 });
  expect(user.access_token_enc).not.toContain("at-d1");
  expect(await decrypt(await importKey(env.TOKEN_KEY), user.access_token_enc)).toBe("at-d1");

  const put = calls.find((c) => c.method === "PUT")!;
  expect(put.auth).toBe("Bearer at-d1");
  expect(JSON.parse(put.body)).toEqual({ platform_name: "GitHub", platform_username: "alice", metadata: { merged_prs: 7 } });
  expect(decodeURIComponent(calls.find((c) => c.url.includes("/search/issues"))!.url)).toContain(
    "repo:acme/widgets+is:pr+is:merged+author:alice",
  );
});

it("refuses a GitHub account that is linked to another Discord account", async () => {
  providers("d1", { id: 42, login: "alice" }, 7);
  await link();
  providers("d2", { id: 42, login: "alice" }, 7);
  const res = await link();
  expect(res.status).toBe(409);
  expect((await getUser("d2"))!.github_id).toBeNull();
  expect((await getUser("d1"))!.github_id).toBe(42);
});

it("lets a user re-link a different GitHub account", async () => {
  providers("d1", { id: 42, login: "alice" }, 7);
  await link();
  providers("d1", { id: 43, login: "alice-alt" }, 2);
  expect((await link()).status).toBe(200);
  expect(await getUser("d1")).toMatchObject({ github_id: 43, github_login: "alice-alt", merged_prs: 2 });
});

it("rejects a state without the matching cookie, on both legs, and a replayed state", async () => {
  providers("d1", { id: 42, login: "alice" }, 7);
  const start = await get("/linked-role");
  expect((await get(`/discord/callback?code=dc&state=${stateOf(start)}`)).status).toBe(400);
  expect((await get(`/discord/callback?code=dc&state=${stateOf(start)}`, "link_state=other")).status).toBe(400);

  const mid = await get(`/discord/callback?code=dc&state=${stateOf(start)}`, cookieOf(start));
  expect((await get(`/github/callback?code=gc&state=${stateOf(mid)}`)).status).toBe(400);
  expect((await get(`/github/callback?code=gc&state=${stateOf(mid)}`, cookieOf(mid))).status).toBe(200);
  expect((await get(`/github/callback?code=gc&state=${stateOf(mid)}`, cookieOf(mid))).status).toBe(400);
  // A Discord-leg state cannot be used on the GitHub leg.
  const again = await get("/linked-role");
  expect((await get(`/github/callback?code=gc&state=${stateOf(again)}`, cookieOf(again))).status).toBe(400);
});

it("rejects an expired state", async () => {
  providers("d1", { id: 42, login: "alice" }, 7);
  const start = await get("/linked-role");
  await env.DB.prepare("UPDATE oauth_state SET expires_at = 1").run();
  expect((await get(`/discord/callback?code=dc&state=${stateOf(start)}`, cookieOf(start))).status).toBe(400);
});
