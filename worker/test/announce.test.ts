import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { parseFeed } from "../src/bot/announce";
import { runCron } from "../src/bot/cron";
import type { Env } from "../src/bot/env";
import { PULLS, WEBHOOK, json, mockFetch, pull, pulls, setCursor } from "./helpers";

const T0 = "2026-10-01T00:00:00Z";
const at = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, "0")}:00Z`;
// Minute 7 runs only the merge poll; minute 10 also checks releases and the games feed.
const POLL_ONLY = new Date(at(7));
const EVERYTHING = new Date(at(10));
const hook = (name: string) => `https://discord.com/api/webhooks/${name}/secret`;
const posts = (calls: { url: string; body: string }[], name: string) =>
  calls.filter((c) => c.url === hook(name)).map((c) => JSON.parse(c.body));
const withEnv = (extra: Partial<Env>) => ({ ...env, ...extra }) as Env;

it("sends features and fixes to the progress channel, and other merges only to a dev channel", async () => {
  await setCursor(T0);
  const merged = [
    { ...pull(3, at(3)), title: "docs(tools): explain the bisect helper" },
    { ...pull(2, at(2)), title: "feat(shader): decode V_CVT_PK_U8_F32" },
  ];
  const routes = { [PULLS]: () => pulls(merged), [WEBHOOK]: () => new Response(null, { status: 204 }) };

  let calls = mockFetch(routes);
  await runCron(withEnv({ DISCORD_WEBHOOK_PROGRESS: hook("progress") }), POLL_ONLY);
  expect(posts(calls, "progress").map((p) => p.embeds[0].title)).toEqual(["#2 Shader recompiler: decode V_CVT_PK_U8_F32"]);
  expect(calls.filter((c) => c.url.includes("/webhooks/"))).toHaveLength(1);

  await env.DB.prepare("DELETE FROM merges").run();
  await setCursor(T0);
  calls = mockFetch(routes);
  await runCron(withEnv({ DISCORD_WEBHOOK_PROGRESS: hook("progress"), DISCORD_WEBHOOK_DEV: hook("dev") }), POLL_ONLY);
  expect(posts(calls, "dev").map((p) => p.embeds[0].title)).toEqual(["#3 Tools and docs: explain the bisect helper"]);
  expect(posts(calls, "progress")).toHaveLength(1);
});

it("records unannounced merges, so they are not reconsidered", async () => {
  await setCursor(T0);
  mockFetch({ [PULLS]: () => pulls([{ ...pull(2, at(2)), title: "test(libc): cover strtod" }]) });
  await runCron(env, POLL_ONLY);
  expect(await env.DB.prepare("SELECT number FROM merges").all()).toMatchObject({ results: [{ number: 2 }] });
});

it("links games a merge names", async () => {
  await setCursor(T0);
  const calls = mockFetch({
    [PULLS]: () => pulls([{ ...pull(2, at(2)), title: "fix(agc): blend unclamped targets for PPSA21564" }]),
    [WEBHOOK]: () => new Response(null, { status: 204 }),
  });
  await runCron(env, POLL_ONLY);
  const [post] = posts(calls, "1");
  expect(post.embeds[0].color).toBe(0xf5b84a);
  expect(post.embeds[0].fields.at(-1)).toEqual({ name: "Games", value: "[PPSA21564](https://worker.test/compatibility/?q=PPSA21564)", inline: false });
});

it("announces a new release once, after first recording the current one", async () => {
  await setCursor(T0);
  let tag = "v0.1.3";
  const calls = mockFetch({
    "GET https://api.github.com/repos/acme/widgets/releases/latest": () =>
      json({ tag_name: tag, name: tag, html_url: `https://github.com/acme/widgets/releases/${tag}`, body: "Notes", published_at: T0 }),
    [PULLS]: () => pulls([]),
    [WEBHOOK]: () => new Response(null, { status: 204 }),
  });
  const e = withEnv({ DISCORD_WEBHOOK_RELEASES: hook("releases") });

  await runCron(e, EVERYTHING);
  expect(posts(calls, "releases")).toHaveLength(0);
  tag = "v0.1.4";
  await runCron(e, EVERYTHING);
  await runCron(e, EVERYTHING);
  const sent = posts(calls, "releases");
  expect(sent).toHaveLength(1);
  expect(sent[0].embeds[0]).toMatchObject({ title: "AnyPS5 v0.1.4", description: "Notes", url: "https://github.com/acme/widgets/releases/v0.1.4" });
  // Off the five-minute mark, releases are not checked at all.
  const before = calls.length;
  await runCron(e, POLL_ONLY);
  expect(calls.slice(before).some((c) => c.url.includes("/releases/"))).toBe(false);
});

const feed = (...entries: [id: string, title: string][]) =>
  `<feed>${entries.map(([id, title]) => `<entry><id>https://site.test/updates#${id}</id><title>${title}</title><link href="https://site.test/compatibility/${id}"/><updated>${T0}</updated><summary>Up from Starts.</summary></entry>`).join("")}</feed>`;

it("posts games that reach a new stage, each once, starting from what the feed already has", async () => {
  await setCursor(T0);
  let xml = feed(["stage:a:Menus", "Game A reaches Menus"]);
  const calls = mockFetch({ [PULLS]: () => pulls([]), [WEBHOOK]: () => new Response(null, { status: 204 }) });
  const e = withEnv({ DISCORD_WEBHOOK_GAMES: hook("games"), ASSETS: { fetch: async () => new Response(xml) } as unknown as Fetcher });

  await runCron(e, EVERYTHING);
  expect(posts(calls, "games")).toHaveLength(0);
  xml = feed(["stage:b:Ingame", "Game B &amp; C reaches Ingame"], ["stage:a:Menus", "Game A reaches Menus"]);
  await runCron(e, EVERYTHING);
  await runCron(e, EVERYTHING);
  const sent = posts(calls, "games");
  expect(sent.map((p) => p.embeds[0].title)).toEqual(["Game B & C reaches Ingame"]);
  expect(sent[0].allowed_mentions).toEqual({ parse: [] });
});

it("reads the site's Atom feeds", () => {
  expect(parseFeed(feed(["x", "A &lt;b&gt; &quot;c&quot;"]))).toEqual([
    { id: "/updates#x", title: 'A <b> "c"', url: "https://site.test/compatibility/x", updated: T0, summary: "Up from Starts." },
  ]);
});

const DISPATCH = "POST https://api.github.com/repos/acme/site/dispatches";
const dispatches = (calls: { url: string; body: string }[]) => calls.filter((c) => c.url.endsWith("/dispatches"));
const rebuilding = (extra: Partial<Env> = {}) => withEnv({ SITE_DISPATCH_TOKEN: "dispatch", SITE_REPO: "acme/site", ...extra });

it("rebuilds the site after a user-facing merge, but not after a test-only one", async () => {
  await setCursor(T0);
  let calls = mockFetch({ [PULLS]: () => pulls([{ ...pull(2, at(2)), title: "test(libc): cover strtod" }]), [DISPATCH]: () => new Response(null, { status: 204 }) });
  await runCron(rebuilding(), POLL_ONLY);
  expect(dispatches(calls)).toHaveLength(0);

  calls = mockFetch({
    [PULLS]: () => pulls([{ ...pull(3, at(3)), title: "feat(libkernel): implement ksem" }]),
    [WEBHOOK]: () => new Response(null, { status: 204 }),
    [DISPATCH]: () => new Response(null, { status: 204 }),
  });
  await runCron(rebuilding(), POLL_ONLY);
  expect(dispatches(calls)).toHaveLength(1);
  expect(JSON.parse(dispatches(calls)[0]!.body)).toMatchObject({ event_type: "site-data-changed", client_payload: { reason: "merge" } });
});

it("rebuilds the site when Game bring-up discussions change, after first recording where they are", async () => {
  await setCursor(T0);
  let updated = "2026-10-01T00:05:00Z";
  const calls = mockFetch({
    "POST https://api.github.com/graphql": (call) =>
      call.body.includes("discussions(")
        ? json({ data: { repository: { discussions: { nodes: [{ updatedAt: "2026-10-01T09:00:00Z", category: { name: "General" } }, { updatedAt: updated, category: { name: "Game bring-up" } }] } } } })
        : pulls([]),
    [DISPATCH]: () => new Response(null, { status: 204 }),
  });
  await runCron(rebuilding(), EVERYTHING);
  expect(dispatches(calls)).toHaveLength(0);
  await runCron(rebuilding(), EVERYTHING);
  expect(dispatches(calls)).toHaveLength(0);
  updated = "2026-10-01T00:09:00Z";
  await env.SITE_DB!.prepare("DELETE FROM site_kv WHERE key = 'rebuild_at'").run();
  await runCron(rebuilding(), EVERYTHING);
  expect(dispatches(calls)).toHaveLength(1);
});

it("posts each finished day's progress summary once, never today's", async () => {
  await setCursor(T0);
  const digest = (day: string) => [`digest:${day}`, `Progress on ${day}: 100 changes merged`] as [string, string];
  let xml = feed(digest("2026-09-30"));
  const calls = mockFetch({ [PULLS]: () => pulls([]), [WEBHOOK]: () => new Response(null, { status: 204 }) });
  const e = withEnv({ DISCORD_WEBHOOK_PROGRESS: hook("progress"), ASSETS: { fetch: async () => new Response(xml) } as unknown as Fetcher });

  await runCron(e, EVERYTHING);
  expect(posts(calls, "progress")).toHaveLength(0);
  xml = feed(digest("2026-10-01"), digest("2026-09-30"));
  await runCron(e, EVERYTHING);
  expect(posts(calls, "progress")).toHaveLength(0);
  // Just after midnight the site may not have rebuilt with the day's last merges yet, so nothing is posted.
  await runCron(e, new Date("2026-10-02T00:10:00Z"));
  expect(posts(calls, "progress")).toHaveLength(0);
  await runCron(e, new Date("2026-10-02T01:00:00Z"));
  await runCron(e, new Date("2026-10-02T01:10:00Z"));
  expect(posts(calls, "progress").map((p) => p.embeds[0].title)).toEqual(["Progress on 2026-10-01: 100 changes merged"]);
});

it("posts feed entries one by one, so a failure partway through never repeats the earlier ones", async () => {
  await setCursor(T0);
  let xml = feed(["stage:a:Menus", "A reaches Menus"]);
  let fail = "";
  const calls = mockFetch({
    [PULLS]: () => pulls([]),
    [WEBHOOK]: (call) => (fail && call.body.includes(fail) ? new Response(null, { status: 400 }) : new Response(null, { status: 204 })),
  });
  const e = withEnv({ DISCORD_WEBHOOK_GAMES: hook("games"), ASSETS: { fetch: async () => new Response(xml) } as unknown as Fetcher });
  await runCron(e, EVERYTHING);
  xml = feed(["stage:c:Ingame", "C reaches Ingame"], ["stage:b:Ingame", "B reaches Ingame"], ["stage:a:Menus", "A reaches Menus"]);
  fail = "C reaches";
  await runCron(e, EVERYTHING);
  fail = "";
  await runCron(e, EVERYTHING);
  // C's first attempt failed and was retried on the next run; B, posted before the failure, was not posted again.
  expect(posts(calls, "games").map((p) => p.embeds[0].title)).toEqual(["B reaches Ingame", "C reaches Ingame", "C reaches Ingame"]);
});

it("keeps a rebuild request made in the quiet period, and sends it once the period has passed", async () => {
  await setCursor(T0);
  const calls = mockFetch({
    [PULLS]: () => pulls([{ ...pull(2, at(2)), title: "feat(libc): add strtold" }]),
    [WEBHOOK]: () => new Response(null, { status: 204 }),
    [DISPATCH]: () => new Response(null, { status: 204 }),
  });
  await env.SITE_DB!.prepare("INSERT INTO site_kv (key, value) VALUES ('rebuild_at', ?)").bind(String(Math.floor(Date.now() / 1000))).run();
  await runCron(rebuilding(), POLL_ONLY);
  expect(dispatches(calls)).toHaveLength(0);
  expect(await env.SITE_DB!.prepare("SELECT value FROM site_kv WHERE key = 'rebuild_pending'").first<string>("value")).toBe("merge");
  await env.SITE_DB!.prepare("UPDATE site_kv SET value = '0' WHERE key = 'rebuild_at'").run();
  await runCron(rebuilding(), POLL_ONLY);
  expect(dispatches(calls)).toHaveLength(1);
  expect(await env.SITE_DB!.prepare("SELECT value FROM site_kv WHERE key = 'rebuild_pending'").first()).toBeNull();
});
