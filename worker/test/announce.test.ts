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
    { id: "https://site.test/updates#x", title: 'A <b> "c"', url: "https://site.test/compatibility/x", updated: T0, summary: "Up from Starts." },
  ]);
});
