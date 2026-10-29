import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { runCron } from "../src/bot/cron";
import { decrypt, importKey } from "../src/bot/crypto";
import { DISCORD_TOKEN, PULLS, ROLE, SEARCH, WEBHOOK, addUser, getCursor, found, getUser, json, mockFetch, pull, pulls, setCursor } from "./helpers";

const T0 = "2026-10-01T00:00:00Z";
const at = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, "0")}:00Z`;
const announced = (calls: { url: string; body: string }[]) =>
  calls.filter((c) => c.url.includes("/webhooks/")).map((c) => JSON.parse(c.body));

it("announces nothing on the first run and starts the cursor at now", async () => {
  const calls = mockFetch({});
  await runCron(env);
  expect(calls).toHaveLength(0);
  expect(Date.parse((await getCursor())!)).toBeGreaterThan(Date.now() - 5000);
});

it("announces a new merge once and skips bots", async () => {
  await setCursor(T0);
  const merged = [pull(3, at(3), "dependabot[bot]", 9), pull(2, at(2)), pull(0, "2026-09-30T00:00:00Z")];
  const calls = mockFetch({ [PULLS]: () => pulls(merged), [WEBHOOK]: () => new Response(null, { status: 204 }) });

  await runCron(env);
  await runCron(env);

  const posts = announced(calls);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toEqual({
    embeds: [
      {
        author: { name: "alice", url: "https://github.com/alice", icon_url: "https://avatars.test/1" },
        title: "#2 libkernel: PR 2",
        url: "https://github.com/acme/widgets/pull/2",
        description: "Merged by maintainer",
        color: 0x5b9bff,
        fields: [
          { name: "Area", value: "System libraries · libkernel", inline: true },
          { name: "Type", value: "Fix", inline: true },
          { name: "Changes", value: "+10 \u22122 in 3 files", inline: true },
        ],
        timestamp: at(2),
      },
    ],
    allowed_mentions: { parse: [] },
  });
  expect(await getCursor()).toBe(at(3));
});

it("pings a linked author, and only them, and bumps their count", async () => {
  await setCursor(T0);
  await addUser({ discord_id: "d1", github_id: 1, merged_prs: 5, synced_at: Math.floor(Date.now() / 1000) });
  const calls = mockFetch({
    [PULLS]: () => pulls([pull(2, at(2))]),
    [WEBHOOK]: () => new Response(null, { status: 204 }),
    [SEARCH]: () => json({ total_count: 6, incomplete_results: false }),
    [ROLE]: () => json({}),
  });

  await runCron(env);

  const [post] = announced(calls);
  expect(post.content).toBe("<@d1>");
  expect(post.allowed_mentions).toEqual({ users: ["d1"] });
  const puts = calls.filter((c) => c.method === "PUT");
  expect(puts).toHaveLength(1);
  expect(puts[0]!.auth).toBe("Bearer access-d1");
  expect(JSON.parse(puts[0]!.body).metadata).toEqual({ merged_prs: 6 });
  expect((await getUser("d1"))!.merged_prs).toBe(6);
});

it("announces 20 merges over successive runs, 10 at a time, losing none", async () => {
  await setCursor(T0);
  const merged = Array.from({ length: 20 }, (_, i) => pull(i + 1, at(i + 1))).reverse();
  const calls = mockFetch({ [PULLS]: () => pulls(merged), [WEBHOOK]: () => new Response(null, { status: 204 }) });

  await runCron(env);
  expect(announced(calls)).toHaveLength(10);
  await runCron(env);
  await runCron(env);

  expect(announced(calls).map((p) => p.embeds[0].title)).toEqual(merged.map((p) => `#${p.number} libkernel: PR ${p.number}`).reverse());
});

it("retries a failed announcement on the next run instead of skipping it", async () => {
  await setCursor(T0);
  let down = true;
  const calls = mockFetch({
    [PULLS]: () => pulls([pull(2, at(2)), pull(1, at(1))]),
    [WEBHOOK]: () => new Response(null, { status: down ? 400 : 204 }),
  });

  await runCron(env);
  expect(await getCursor()).toBe(T0);
  down = false;
  await runCron(env);
  expect(announced(calls).slice(1).map((p) => p.embeds[0].title)).toEqual(["#1 libkernel: PR 1", "#2 libkernel: PR 2"]);
});

it("catches up on a backlog too big for the list by searching a shrinking window", async () => {
  await setCursor(T0);
  const searches: string[] = [];
  const calls = mockFetch({
    [PULLS]: (call) => {
      const { query, variables } = JSON.parse(call.body);
      // The list is full of newer activity and never reaches back to the cursor.
      if (!query.includes("search(")) return pulls([pull(50, at(50))], true);
      searches.push(variables.q);
      // The whole window holds too many; half of it holds two.
      return searches.length === 1 ? found([pull(9, at(9))], 150) : found([pull(2, at(2)), pull(1, at(1))]);
    },
    [WEBHOOK]: () => new Response(null, { status: 204 }),
  });

  await runCron(env);

  expect(searches).toHaveLength(2);
  expect(searches[0]).toMatch(/^repo:acme\/widgets is:pr is:merged merged:2026-10-01T00:00:00Z\.\.20/);
  expect(Date.parse(searches[1]!.split("..")[1]!)).toBeLessThan(Date.parse(searches[0]!.split("..")[1]!));
  expect(announced(calls).map((p) => p.embeds[0].title)).toEqual(["#1 libkernel: PR 1", "#2 libkernel: PR 2"]);
  expect(await getCursor()).toBe(at(2));
});

it("does not announce a merge that is already in the history", async () => {
  await setCursor(T0);
  await env.DB.prepare("INSERT INTO merges VALUES (2, 'PR 2', 1, 'alice', ?)").bind(at(2)).run();
  const calls = mockFetch({
    [PULLS]: () => pulls([pull(3, at(3)), pull(2, at(2)), pull(0, "2026-09-30T00:00:00Z")]),
    [WEBHOOK]: () => new Response(null, { status: 204 }),
  });
  await runCron(env);
  expect(announced(calls).map((p) => p.embeds[0].title)).toEqual(["#3 libkernel: PR 3"]);
  expect(await getCursor()).toBe(at(3));
});

it("treats a GraphQL error response as a failed poll", async () => {
  await setCursor(T0);
  const calls = mockFetch({ [PULLS]: () => json({ errors: [{ message: "nope" }] }) });
  await runCron(env);
  expect(announced(calls)).toHaveLength(0);
  expect(await getCursor()).toBe(T0);
});

it("resyncs the 2 least recently synced users and only pushes changes", async () => {
  await setCursor(T0);
  for (let i = 1; i <= 8; i++) await addUser({ discord_id: `d${i}`, github_id: i, github_login: `u${i}`, merged_prs: 3, synced_at: i });
  const calls = mockFetch({
    [PULLS]: () => pulls([]),
    [SEARCH]: (c) => json({ total_count: c.url.includes("author%3Au2") ? 6 : 3, incomplete_results: false }),
    [ROLE]: () => json({}),
  });

  await runCron(env);

  expect(calls.filter((c) => c.url.includes("/search/"))).toHaveLength(2);
  const puts = calls.filter((c) => c.method === "PUT");
  expect(puts.map((c) => c.auth)).toEqual(["Bearer access-d2"]);
  expect((await getUser("d2"))!.merged_prs).toBe(6);
  expect((await getUser("d3"))!.synced_at).toBe(3);
  expect((await getUser("d1"))!.synced_at).toBeGreaterThan(8);
});

it("refreshes a token close to expiry and stores the new pair", async () => {
  await setCursor(T0);
  await addUser({ discord_id: "d1", token_expires_at: Math.floor(Date.now() / 1000) + 3600 });
  const calls = mockFetch({
    [PULLS]: () => pulls([]),
    [DISCORD_TOKEN]: () => json({ access_token: "new-at", refresh_token: "new-rt", expires_in: 604800 }),
    [SEARCH]: () => json({ total_count: 0, incomplete_results: false }),
  });

  await runCron(env);

  expect(calls.find((c) => c.url.includes("oauth2/token"))!.body).toContain("refresh_token=refresh-d1");
  const user = (await getUser("d1"))!;
  const key = await importKey(env.TOKEN_KEY);
  expect(await decrypt(key, user.access_token_enc)).toBe("new-at");
  expect(await decrypt(key, user.refresh_token_enc)).toBe("new-rt");
  expect(user.token_expires_at).toBeGreaterThan(Date.now() / 1000 + 600000);
});

it("deletes a user whose refresh token was revoked, but not on a client-credentials 401", async () => {
  await setCursor(T0);
  await addUser({ discord_id: "d1", token_expires_at: 1 });
  let response = () => json({ error: "invalid_client" }, 401);
  mockFetch({ [PULLS]: () => pulls([]), [DISCORD_TOKEN]: () => response() });

  await runCron(env);
  expect(await getUser("d1")).not.toBeNull();

  response = () => json({ error: "invalid_grant" }, 400);
  await runCron(env);
  expect(await getUser("d1")).toBeNull();
});

it("deletes a user whose metadata PUT returns 401", async () => {
  await setCursor(T0);
  await addUser({ discord_id: "d1", merged_prs: 2 });
  mockFetch({
    [PULLS]: () => pulls([]),
    [SEARCH]: () => json({ total_count: 3, incomplete_results: false }),
    [ROLE]: () => json({}, 401),
  });
  await runCron(env);
  expect(await getUser("d1")).toBeNull();
});

it("follows a renamed GitHub login by id", async () => {
  await setCursor(T0);
  await addUser({ discord_id: "d1", github_id: 42, github_login: "old", merged_prs: 7 });
  const calls = mockFetch({
    [PULLS]: () => pulls([]),
    [SEARCH]: (c) => (c.url.includes("author%3Aold") ? json({ message: "Validation Failed" }, 422) : json({ total_count: 7, incomplete_results: false })),
    "GET https://api.github.com/user/42": () => json({ login: "new" }),
    [ROLE]: () => json({}),
  });

  await runCron(env);

  expect(await getUser("d1")).toMatchObject({ github_login: "new", merged_prs: 7 });
  expect(JSON.parse(calls.find((c) => c.method === "PUT")!.body).platform_username).toBe("new");
});

it("retries 429 and 5xx responses", async () => {
  await setCursor(T0);
  await addUser({ discord_id: "d1", merged_prs: 2 });
  let searches = 0;
  mockFetch({
    [PULLS]: () => pulls([]),
    [SEARCH]: () =>
      ++searches === 1 ? new Response(null, { status: 429, headers: { "retry-after": "0" } }) : json({ total_count: 3, incomplete_results: false }),
    [ROLE]: () => json({}),
  });
  await runCron(env);
  expect(searches).toBe(2);
  expect((await getUser("d1"))!.merged_prs).toBe(3);
});

it("stays within the subrequest budget in the worst case", async () => {
  await setCursor(T0);
  const soon = Math.floor(Date.now() / 1000) + 60;
  for (let i = 1; i <= 12; i++) await addUser({ discord_id: `d${i}`, github_id: i, github_login: `u${i}`, merged_prs: 1, token_expires_at: soon, synced_at: i });
  const merged = Array.from({ length: 20 }, (_, i) => pull(i + 1, at(i + 1), `u${i + 1}`, i + 1)).reverse();
  let n = 0;
  const calls = mockFetch({
    [PULLS]: () => pulls(merged),
    [WEBHOOK]: () => new Response(null, { status: 204 }),
    [DISCORD_TOKEN]: () => json({ access_token: "a", refresh_token: "r", expires_in: 3600 }),
    [SEARCH]: () => json({ total_count: 100 + n++, incomplete_results: false }),
    [ROLE]: () => json({}),
  });
  await runCron(env);
  expect(calls.length).toBeLessThanOrEqual(48);
  expect(announced(calls)).toHaveLength(9);
  expect(calls.filter((c) => c.method === "PUT").length).toBe(11);
});

it("cleans up expired state and abandoned half-linked users", async () => {
  const t = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO oauth_state VALUES ('old', NULL, ?), ('live', NULL, ?)").bind(t - 1, t + 600).run();
  await addUser({ discord_id: "stale", github_id: null, github_login: null, created_at: t - 7200 });
  await addUser({ discord_id: "fresh", github_id: null, github_login: null });
  mockFetch({});
  await runCron(env);
  const states = await env.DB.prepare("SELECT state FROM oauth_state").all();
  expect(states.results).toEqual([{ state: "live" }]);
  expect(await getUser("stale")).toBeNull();
  expect(await getUser("fresh")).not.toBeNull();
});

it("labels the area and type, and copes with a deleted or non-user author", async () => {
  await setCursor(T0);
  const calls = mockFetch({
    [PULLS]: () =>
      pulls([
        { ...pull(3, at(3)), author: null as any, mergedBy: null as any },
        { ...pull(2, at(2)), labels: { nodes: [{ name: "bug" }, { name: "ui" }] } },
      ]),
    [WEBHOOK]: () => new Response(null, { status: 204 }),
  });
  await runCron(env);
  const [labelled, ghost] = announced(calls);
  expect(labelled.embeds[0].fields.slice(0, 2)).toEqual([
    { name: "Area", value: "System libraries · libkernel", inline: true },
    { name: "Type", value: "Fix", inline: true },
  ]);
  expect(ghost.embeds[0].author).toBeUndefined();
  expect(ghost.embeds[0].description).toBeUndefined();
  expect(await getCursor()).toBe(at(3));
});

it("records every merge, bots included, in the history table", async () => {
  await setCursor(T0);
  mockFetch({
    [PULLS]: () => pulls([pull(3, at(3), "dependabot[bot]", 9), pull(2, at(2), "alice", 1)]),
    [WEBHOOK]: () => new Response(null, { status: 204 }),
  });
  await runCron(env);
  await runCron(env);
  const { results } = await env.DB.prepare("SELECT * FROM merges ORDER BY number").all();
  expect(results).toEqual([
    { number: 2, title: "fix(libkernel): PR 2", author_id: 1, author_login: "alice", merged_at: at(2) },
    { number: 3, title: "fix(libkernel): PR 3", author_id: 9, author_login: "dependabot[bot]", merged_at: at(3) },
  ]);
});
