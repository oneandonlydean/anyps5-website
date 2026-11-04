import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { forgetSiteData, meter, type SiteData } from "../src/bot/site-data";
import worker from "../src/index";
import { addUser, ctx } from "./helpers";

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

const DATA: SiteData = {
  generated: "2026-11-02T00:00:00Z",
  games: [
    {
      slug: "astro-bot",
      name: "Astro Bot",
      ids: ["PPSA01234"],
      stage: "Menus",
      cover: "https://img.test/astro.png",
      tested: { date: "2026-10-20T00:00:00Z", build: "main after v0.1.3", releasesSince: 1 },
      blockers: [{ number: 42, kind: "issue", title: "VideoOut: unsupported pixel format", url: "https://github.com/acme/widgets/issues/42" }],
      thread: "https://github.com/acme/widgets/discussions/7",
    },
    { slug: "astro-playroom", name: "Astro's Playroom", ids: ["PPSA00001"], stage: "Ingame", cover: null, tested: null, blockers: [], thread: "https://github.com/acme/widgets/discussions/8" },
  ],
  libraries: {
    done: 50,
    total: 200,
    groups: [
      { name: "Pad", done: 10, total: 40 },
      { name: "libkernel", done: 30, total: 60 },
      { name: "Rtc", done: 9, total: 10 },
      { name: "Fiber", done: 1, total: 1 },
    ],
    milestones: [{ date: "2026-11-01", library: "Fiber", kind: "complete", done: 1, total: 1 }],
  },
  shaders: {
    decoded: 90,
    translated: 80,
    total: 100,
    dpp: { total: 20, decoded: 19 },
    formats: { total: 159, sampled: 81, buffer: 80, host: 68 },
    throws: { total: 148, areas: [{ name: "RdnaDecoder", count: 59 }] },
    untranslated: ["IMAGE_GATHER8H_PCK"],
  },
  stages: { now: { Menus: 1, Ingame: 1, "Not converting": 1 }, week: { date: "2026-10-26", counts: { Menus: 1 } }, month: { date: "2026-10-03", counts: {} } },
  testers: {
    totals: { testers: 2, reports: 5, uploads: 1, month: 4, week: 1 },
    people: [
      { login: "alice", reports: 4, uploads: 0, games: 3, month: 2, week: 0, last: "2026-10-20T00:00:00Z" },
      { login: "Bob", reports: 1, uploads: 1, games: 1, month: 2, week: 1, last: "2026-11-01T00:00:00Z" },
    ],
  },
  wanted: [{ name: "scePadSetLightBar", library: "Pad", games: ["Astro Bot", "Astro's Playroom"] }],
  release: {
    tag: "v0.1.4",
    name: "v0.1.4",
    url: "https://github.com/acme/widgets/releases/tag/v0.1.4",
    published: "2026-10-30T23:00:00Z",
    downloads: { linux: { name: "relinker-v0.1.4", url: "https://dl.test/linux", size: 5_000_000 }, windows: null, librariesLinux: null, librariesWindows: null },
  },
  tracked: { release: "v0.1.4", games: [{ slug: "astro-bot", name: "Astro Bot", stage: "Menus", ready: false }, { slug: "astro-playroom", name: "Astro's Playroom", stage: null, ready: true }] },
  faq: [{ id: "q1-2", q: "Is it an emulator?", a: "No. See [the guide](/docs/guide)." }],
  answers: [{ topic: "report", title: "How do I report a game?", text: "Use [the report page](/report)." }],
  rules: null,
};

let keys: CryptoKeyPair;
let testEnv: typeof env;
let data: SiteData;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  testEnv = {
    ...env,
    DISCORD_PUBLIC_KEY: hex((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer),
    ASSETS: { fetch: async (url: string) => (String(url).endsWith("/bot/data.json") ? Response.json(data) : new Response("", { status: 404 })) } as unknown as Fetcher,
  };
});

beforeEach(() => {
  data = structuredClone(DATA);
  forgetSiteData();
});

async function send(interaction: unknown): Promise<any> {
  const body = JSON.stringify(interaction);
  const timestamp = "1700000000";
  const signature = hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body)));
  const res = await worker.fetch(
    new Request("https://worker.test/interactions", { method: "POST", headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp }, body }) as any,
    testEnv,
    ctx,
  );
  return res.json();
}

const run = (name: string, options: Record<string, string> = {}, caller = "d1") =>
  send({ type: 2, data: { name, options: Object.entries(options).map(([n, value]) => ({ name: n, type: 3, value })) }, member: { user: { id: caller } } });
const typing = (name: string, option: string, value: string, caller = "d1") =>
  send({ type: 4, data: { name, options: [{ name: option, type: 3, value, focused: true }] }, member: { user: { id: caller } } });

it("/game shows a game's stage, last test and blockers, by name, title ID or the slug autocomplete chose", async () => {
  for (const name of ["astro bot", "PPSA01234", "astro-bot"]) {
    const { data: reply } = await run("game", { name });
    const embed = reply.embeds[0];
    expect(embed.title).toBe("Astro Bot");
    expect(embed.url).toBe("https://worker.test/compatibility/astro-bot");
    expect(embed.fields.map((f: any) => f.value)).toEqual(expect.arrayContaining(["Menus", "PPSA01234", expect.stringContaining("main after v0.1.3 · 1 release ago")]));
    expect(embed.fields.at(-1).value).toContain("[#42](https://github.com/acme/widgets/issues/42) VideoOut");
  }
  expect((await run("game", { name: "zelda" })).data).toMatchObject({ flags: 64, content: expect.stringContaining('No game on the compatibility list matches "zelda"') });
});

it("suggests games, libraries and FAQ topics as people type", async () => {
  const games = await typing("game", "name", "astro");
  expect(games.type).toBe(8);
  expect(games.data.choices).toEqual([
    { name: "Astro Bot · Menus", value: "astro-bot" },
    { name: "Astro's Playroom · Ingame", value: "astro-playroom" },
  ]);
  expect((await typing("library", "name", "ker")).data.choices).toEqual([{ name: "libkernel · 30/60", value: "libkernel" }]);
  expect((await typing("faq", "topic", "emulator")).data.choices).toEqual([{ name: "Is it an emulator?", value: "q:q1-2" }]);
});

it("/progress, /library and /wanted show coverage and what games wait on", async () => {
  const progress = (await run("progress")).data.embeds[0];
  expect(progress.fields.map((f: any) => f.name)).toEqual(["System libraries", "Shader recompiler", "Games"]);
  expect(progress.fields[0].value).toContain("50 of 200 functions");
  expect(progress.fields[2].value).toBe("2 tested · 2 show frames · 1 reach gameplay · 0 playable");

  const pad = (await run("library", { name: "scePad" })).data.embeds[0];
  expect(pad.title).toBe("Pad library");
  expect(pad.description).toContain("10 of 40 functions implemented");
  expect(pad.fields[0].value).toContain("`scePadSetLightBar` · 2 games");

  expect((await run("wanted")).data.embeds[0].description).toContain("1. `scePadSetLightBar` (Pad) · Astro Bot, Astro's Playroom");
});

it("/release, /tracked and /report link where to go", async () => {
  const release = (await run("release")).data.embeds[0];
  expect(release.fields[0]).toMatchObject({ name: "Relinker", value: "[Linux](https://dl.test/linux) 4.8 MB" });
  const tracked = (await run("tracked")).data.embeds[0];
  expect(tracked.description).toBe("0 of 2 reach gameplay; 1 of 2 have been run on it.");
  expect(tracked.fields[1].value).toBe("Astro's Playroom (what stopped it is fixed)");
  const report = (await run("report", { game: "astro-bot" })).data;
  expect(report.flags).toBe(64 | 4);
  expect(report.content).toContain("https://github.com/acme/widgets/discussions/7");
  expect(report.content).toContain("https://worker.test/report?game=astro-bot");
});

it("/faq answers from data/bot.yaml and the site's FAQ, with site links made absolute; /rules waits until set", async () => {
  expect((await run("faq", { topic: "a:report" })).data.embeds[0]).toMatchObject({ title: "How do I report a game?", description: "Use [the report page](https://worker.test/report)." });
  expect((await run("faq", { topic: "emulator" })).data.embeds[0]).toMatchObject({ title: "Is it an emulator?", url: "https://worker.test/faq#q1-2" });
  expect((await run("rules")).data.content).toContain("aren't set yet");
  data.rules = "1. Be kind.";
  forgetSiteData();
  expect((await run("rules")).data.embeds[0].description).toBe("1. Be kind.");
});

it("/follow, /following and /unfollow keep a member's list", async () => {
  expect((await run("follow", { game: "astro-bot" })).data.content).toContain("Following **Astro Bot** (Menus)");
  expect((await run("following")).data.content).toContain("[Astro Bot](https://worker.test/compatibility/astro-bot) · Menus");
  expect((await typing("unfollow", "game", "astro")).data.choices).toEqual([{ name: "Astro Bot", value: "astro-bot" }]);
  expect((await run("unfollow", { game: "astro-bot" })).data.content).toBe("Stopped following **Astro Bot**.");
  expect((await run("following")).data.content).toContain("You don't follow any games");
});

it("says so when the site's data can't be read", async () => {
  const broken = { ...testEnv, ASSETS: { fetch: async () => new Response("nope", { status: 500 }) } as unknown as Fetcher };
  const body = JSON.stringify({ type: 2, data: { name: "progress" }, member: { user: { id: "d1" } } });
  const signature = hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode("1" + body)));
  const res = await worker.fetch(new Request("https://worker.test/interactions", { method: "POST", headers: { "x-signature-ed25519": signature, "x-signature-timestamp": "1" }, body }) as any, broken, ctx);
  expect((await res.json<any>()).data.content).toContain("isn't available right now");
});

it("draws text meters", () => {
  expect(meter(1, 4, 8)).toBe("▰▰▱▱▱▱▱▱ 25%");
  expect(meter(1, 200, 4)).toBe("▱▱▱▱ 0.5%");
  expect(meter(1456, 1460, 4)).toBe("▰▰▰▰ 99.7%");
  expect(meter(4, 4, 4)).toBe("▰▰▰▰ 100%");
});

it("/progress goes into libraries, shaders or games in depth", async () => {
  const libraries = (await run("progress", { area: "libraries" })).data.embeds[0];
  expect(libraries.fields.map((f: any) => f.name)).toEqual(["Functions", "Libraries", "Biggest", "Nearly done", "Latest milestones"]);
  expect(libraries.fields[1].value).toBe("1 complete · 3 started · 0 not started · 4 in all");
  expect(libraries.fields[3].value).toBe("Rtc · 9/10, 1 to go");
  expect(libraries.fields[4].value).toMatch(/^Fiber complete · <t:\d+:D>$/);

  const shaders = (await run("progress", { area: "shaders" })).data.embeds[0];
  expect(shaders.fields[2].value).toBe("Sampled 81/159 · Typed buffer 80/159 · Vulkan host 68/159");
  expect(shaders.fields[3]).toMatchObject({ name: "Unsupported-throw sites (148)", value: "RdnaDecoder · 59" });
  expect(shaders.fields[4].value).toBe("`IMAGE_GATHER8H_PCK`");

  const games = (await run("progress", { area: "games" })).data.embeds[0];
  expect(games.title).toBe("2 games tested, 1 reach gameplay");
  expect(games.fields[0].value).toContain("`▰▰▰▰▰▰▰▰▰▰` Menus · 1");
  expect(games.fields[0].value).toContain("Not converting · 1");
  expect(games.fields[1].value.split("\n")[0]).toBe("Last 7 days: tested +1 · frames +1 · gameplay +1");
});

it("/progressmap shows the map the site rendered, or says it isn't there", async () => {
  const embed = (await run("progressmap")).data.embeds?.[0];
  expect(embed).toBeUndefined();
  const withMap = {
    ...testEnv,
    ASSETS: { fetch: async (url: string) => (String(url).endsWith("/bot/progress.png") ? new Response(null) : Response.json(data)) } as unknown as Fetcher,
  };
  const body = JSON.stringify({ type: 2, data: { name: "progressmap" }, member: { user: { id: "d1" } } });
  const signature = hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode("1" + body)));
  const res = await worker.fetch(new Request("https://worker.test/interactions", { method: "POST", headers: { "x-signature-ed25519": signature, "x-signature-timestamp": "1" }, body }) as any, withMap, ctx);
  const image = (await res.json<any>()).data.embeds[0].image.url;
  expect(image).toBe(`https://worker.test/bot/progress.png?v=${Date.parse(DATA.generated)}`);
});

it("/progress shows the card the site drew, with the headline figures as text", async () => {
  const withCard = {
    ...testEnv,
    ASSETS: { fetch: async (url: string) => (String(url).split("?")[0]!.endsWith("/bot/progress-card.jpg") ? new Response(null) : Response.json(data)) } as unknown as Fetcher,
  };
  const body = JSON.stringify({ type: 2, data: { name: "progress" }, member: { user: { id: "d1" } } });
  const signature = hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode("1" + body)));
  const res = await worker.fetch(new Request("https://worker.test/interactions", { method: "POST", headers: { "x-signature-ed25519": signature, "x-signature-timestamp": "1" }, body }) as any, withCard, ctx);
  const embed = (await res.json<any>()).data.embeds[0];
  expect(embed.image.url).toBe(`https://worker.test/bot/progress-card.jpg?v=${Date.parse(DATA.generated)}`);
  expect(embed.description).toBe("**25%** of library functions · **90%** of shader instructions · **1** of 2 games reach gameplay");
  expect(embed.fields).toBeUndefined();
});

it("/leaderboard testers ranks reporters by period, with linked members named", async () => {
  await addUser({ discord_id: "d9", github_id: 9, github_login: "bob" });
  const all = (await run("leaderboard", { board: "testers" })).data.embeds[0];
  expect(all.title).toBe("Top testers · All time");
  expect(all.description).toBe(
    "**6** reports (1 uploaded) · **4** in 30 days · **1** in 7 days · 2 testers\n\n" +
      "🥇 **[alice](<https://github.com/alice>)**\n**4** reports · 2 this month · 0 this week · 3 games\n" +
      "🥈 **[Bob](<https://github.com/Bob>)** <@d9>\n**2** reports · 2 this month · 1 this week · 1 game",
  );
  const week = (await run("leaderboard", { board: "testers", period: "week" })).data.embeds[0];
  expect(week.description.split("\n\n")[1].split("\n")).toHaveLength(2);
});

it("/stats sums up the project", async () => {
  const embed = (await run("stats")).data.embeds[0];
  expect(embed.fields.map((f: any) => f.name)).toEqual(["Merged pull requests", "Contributors", "System libraries", "Shader recompiler", "Games", "Testing", "Latest release"]);
  expect(embed.fields[2].value).toContain("50 implemented of 200 declared functions\n1 of 4 libraries complete, 3 started");
  expect(embed.fields[4].value).toBe("**2** listed\n2 tested · 1 reach gameplay · 0 playable");
});

it("/rule shows one rule, with rules suggested by number or title", async () => {
  data.rules = "**1. No piracy, ever.** Do not share game files. **Instant ban.**\n\n**2. Be respectful.** No harassment.\n\n**9. No spam.**\n\n**Enforcement:** warning → ban.";
  forgetSiteData();
  expect((await run("rule", { number: "1" })).data.embeds[0]).toMatchObject({ title: "Rule 1: No piracy, ever.", description: "Do not share game files. **Instant ban.**" });
  expect((await run("rule", { number: "9" })).data.embeds[0]).toMatchObject({ title: "Rule 9: No spam." });
  expect((await run("rule", { number: "3" })).data.content).toContain("There's no rule 3");
  const suggested = await send({ type: 4, data: { name: "rule", options: [{ name: "number", type: 4, value: "resp", focused: true }] }, member: { user: { id: "d1" } } });
  expect(suggested.data.choices).toEqual([{ name: "2. Be respectful.", value: 2 }]);
});
