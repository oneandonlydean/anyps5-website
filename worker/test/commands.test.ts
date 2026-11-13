import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { forgetLookup } from "../src/bot/lookup";
import { forgetSiteData, meter, type SiteData } from "../src/bot/site-data";
import worker from "../src/index";
import { addUser, ctx } from "./helpers";

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

/** /error's lookup file (src/pages/bot/lookup.json.ts). */
const LOOKUP = {
  commit: "abc1234def5678",
  libraries: ["Http2", "Pad"],
  functions: [
    ["sceHttp2SendRequest", 0, 0],
    ["sceHttp2SendRequestAsync", 0, 0],
    ["scePadOpen", 1, 1],
  ],
  sites: [
    { file: "core/gpu/Mesh.cpp", line: 12, message: "device does not support mesh shaders" },
    { file: "core/gpu/Other.cpp", line: 30, message: "device does not support mesh shaders" },
    { file: "core/gpu/Buffer.cpp", line: 7, message: "guest buffer has no GPU owner" },
  ],
  named: { functions: { sceHttp2SendRequest: ["astro-bot"] }, errors: { "device does not support mesh shaders": ["astro-playroom"] } },
};

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
      systems: { "linux/NVIDIA": "Menus", "windows/AMD": "Starts" },
      latest: {
        source: "upload",
        date: "2026-10-20T00:00:00Z",
        by: "Bob",
        stage: "Menus",
        stated: "Ingame",
        os: "linux",
        gpu: "NVIDIA GeForce RTX 4070",
        build: "main after v0.1.3",
        version: "01.002.000",
        stop: { kind: "missing-function", reason: "runtime-stop", message: "sceHttp2SendRequest is not implemented." },
        recovered: false,
        missing: { names: ["sceHttp2SendRequest", "scePadOpen"], more: 4 },
        unsupported: { names: [], more: 0 },
        perf: { fps: 58.4, low1: 41.2, seconds: 30.2, cap: 60, resolution: "1920x1080" },
        verified: true,
        shown: null,
        url: "/compatibility/astro-bot?report=u12",
      },
      runs: { reports: 2, uploads: 1, testers: 2 },
      history: { releases: [{ release: "v0.1.3", stage: "Menus", results: 2 }, { release: "v0.1.2", stage: "Ingame", results: 1 }], regression: { was: "Ingame", release: "v0.1.2" } },
      retest: { stale: false, ready: true, fixed: ["scePadOpen", "#40"] },
    },
    {
      slug: "astro-playroom",
      name: "Astro's Playroom",
      ids: ["PPSA00001"],
      stage: "Ingame",
      cover: null,
      tested: null,
      blockers: [],
      thread: "https://github.com/acme/widgets/discussions/8",
      systems: { "windows/AMD": "Ingame" },
    },
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
  recent: [
    { kind: "stage", category: "games", date: ago(1), title: "Astro Bot reached Menus", url: "/compatibility/astro-bot", game: "astro-bot" },
    { kind: "release", category: "releases", date: ago(3), title: "AnyPS5 v0.1.4 released", url: "https://github.com/acme/widgets/releases/tag/v0.1.4", game: null },
    { kind: "digest", category: "progress", date: ago(0.5), title: "Progress on Wednesday: 115 changes merged", url: "/updates#progress", game: null },
    { kind: "stage", category: "games", date: ago(20), title: "Astro's Playroom reached Ingame", url: "/compatibility/astro-playroom", game: "astro-playroom" },
  ],
  screenshots: [{ slug: "astro-bot", image: "/community/a1-full.webp", author: "alice", url: "https://github.com/acme/widgets/discussions/7#c1", date: "2026-10-20T00:00:00Z", stage: "Menus" }],
  guide: [
    { slug: "requirements", step: 1, title: "Check your PC", summary: "A Vulkan GPU and Linux or Windows.", sections: [{ heading: "Graphics", anchor: "graphics", text: "You need **Vulkan 1.1**. See [the FAQ](/faq)." }] },
    { slug: "dump", step: 2, title: "Prepare your dump", summary: "Decrypted game files.", sections: [] },
  ],
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
    ASSETS: {
      fetch: async (url: string) => {
        const path = new URL(String(url)).pathname;
        if (path === "/bot/data.json") return Response.json(data);
        if (path === "/bot/lookup.json") return Response.json(LOOKUP);
        return drawn.has(path) ? new Response(null) : new Response("", { status: 404 });
      },
    } as unknown as Fetcher,
  };
});

/** The pictures the site build "drew" for a test. */
let drawn: Set<string>;

beforeEach(() => {
  data = structuredClone(DATA);
  drawn = new Set();
  forgetSiteData();
  forgetLookup();
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
    expect(embed.image.url).toBe(`https://worker.test/og/astro-bot.jpg?v=${Date.parse(DATA.generated)}`);
    const field = (name: string) => embed.fields.find((f: any) => f.name === name)?.value;
    expect(field("Furthest stage")).toBe("Menus");
    expect(field("Title ID")).toBe("PPSA01234");
    expect(field("Tested by")).toBe("2 people · 2 reports, 1 uploaded run");
    expect(field("Latest run (uploaded)").split("\n")).toEqual([
      "<t:1792454400:R> by **Bob** · Linux · NVIDIA GeForce RTX 4070",
      "Build: main after v0.1.3 · game version 01.002.000",
      "Reached **Menus**, and the tester says Ingame · ✅ verified by a maintainer",
      "Stopped on a missing function; AnyPS5 stopped it: sceHttp2SendRequest is not implemented.",
      "Missing: `sceHttp2SendRequest`, `scePadOpen` and 4 more",
      "58.4 fps average · 41.2 fps 1% low · 1920x1080 · capped at 60 · 30 s measured",
      "[Open this run](https://worker.test/compatibility/astro-bot?report=u12)",
    ]);
    expect(field("By release")).toBe("v0.1.3 · Menus (2 runs)\nv0.1.2 · Ingame\n⬇️ Lower than the Ingame it reached on v0.1.2");
    expect(field("Best on each system")).toBe("Linux · NVIDIA: Menus\nWindows · AMD: Starts");
    expect(field("Where it stops")).toContain("[#42](https://github.com/acme/widgets/issues/42) VideoOut");
    expect(field("🔁 Worth running again")).toContain("fixed since (`scePadOpen`, #40)");
    expect(embed.footer.text).toContain("/follow");
  }
  // A Discussions report, and a game whose data has no runs yet.
  data.games[1]!.latest = { source: "report", date: "2026-10-01T00:00:00Z", by: "Ann", stage: "Ingame", stated: null, os: "windows", gpu: "Radeon RX 7800 XT", build: null, buildKind: "prs", version: null, stop: null, recovered: false, missing: null, unsupported: null, perf: null, verified: false, shown: "Plays the first level at 30 FPS.", url: "https://github.com/acme/widgets/discussions/8#c1" };
  forgetSiteData();
  const playroom = (await run("game", { name: "astro-playroom" })).data.embeds[0];
  expect(playroom.fields.find((f: any) => f.name === "Latest run (reported)").value.split("\n")).toEqual([
    "<t:1790812800:R> by **Ann** · Windows · Radeon RX 7800 XT",
    "with open pull requests",
    "Reached **Ingame**",
    "> Plays the first level at 30 FPS.",
    "[Read the report](https://github.com/acme/widgets/discussions/8#c1)",
  ]);
  data.games[1]!.latest = null;
  forgetSiteData();
  expect((await run("game", { name: "astro-playroom" })).data.embeds[0].fields.find((f: any) => f.name === "Last tested").value).toContain("Not yet");
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
  const map = (await res.json<any>()).data.embeds[0];
  expect(map.image.url).toBe(`https://worker.test/bot/progress.png?v=${Date.parse(DATA.generated)}`);
  expect(map.url).toBe(`https://github.com/${testEnv.GITHUB_REPO}`);
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

it("/progress in depth shows the area's card, keeping as text only what the card leaves out", async () => {
  const withCards = {
    ...testEnv,
    ASSETS: { fetch: async (url: string) => (String(url).includes("/bot/cards/") ? new Response(null) : Response.json(data)) } as unknown as Fetcher,
  };
  const ask = async (area: string) => {
    const body = JSON.stringify({ type: 2, data: { name: "progress", options: [{ name: "area", value: area }] }, member: { user: { id: "d1" } } });
    const signature = hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode("1" + body)));
    const res = await worker.fetch(new Request("https://worker.test/interactions", { method: "POST", headers: { "x-signature-ed25519": signature, "x-signature-timestamp": "1" }, body }) as any, withCards, ctx);
    return (await res.json<any>()).data.embeds[0];
  };
  const libraries = await ask("libraries");
  expect(libraries.image.url).toBe(`https://worker.test/bot/cards/libraries.jpg?v=${Date.parse(DATA.generated)}`);
  expect((libraries.fields ?? []).map((f: any) => f.name)).not.toContain("Biggest");
  const games = await ask("games");
  expect(games.image.url).toContain("/bot/cards/games.jpg");
  expect(games.fields.map((f: any) => f.name)).toEqual(["Change", "Tracked games on v0.1.4"]);
  // Without the card, the same view is all text.
  expect((await run("progress", { area: "games" })).data.embeds[0].fields[0].name).toBe("Furthest stage reached");
});

it("/wanted, /library and /leaderboard testers show the card the site drew above their text, when there is one", async () => {
  expect((await run("wanted")).data.embeds[0].image).toBeUndefined();
  drawn = new Set(["/bot/cards/wanted.jpg", "/bot/cards/testers-all.jpg", "/bot/library/libkernel.jpg"]);
  const v = `?v=${Date.parse(DATA.generated)}`;
  const wanted = (await run("wanted")).data.embeds[0];
  expect(wanted.image.url).toBe(`https://worker.test/bot/cards/wanted.jpg${v}`);
  expect(wanted.description ?? wanted.fields).toBeTruthy();
  expect((await run("library", { name: "libkernel" })).data.embeds[0].image.url).toBe(`https://worker.test/bot/library/libkernel.jpg${v}`);
  expect((await run("leaderboard", { board: "testers" })).data.embeds[0].image.url).toBe(`https://worker.test/bot/cards/testers-all.jpg${v}`);
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

it("/recent lists what changed by area, for the period and area asked", async () => {
  const week = (await run("recent")).data.embeds[0];
  expect(week.title).toBe("What's new · Last 7 days");
  expect(week.fields.map((f: any) => f.name)).toEqual(["Games · 1", "Releases · 1", "Progress · 1"]);
  expect(week.fields[0].value).toMatch(/^⬆️ \[Astro Bot reached Menus\]\(https:\/\/worker\.test\/compatibility\/astro-bot\) · <t:\d+:R>$/);
  expect((await run("recent", { period: "month", area: "games" })).data.embeds[0].fields).toEqual([expect.objectContaining({ name: "Games · 2" })]);
  expect((await run("recent", { period: "day", area: "releases" })).data.content).toContain("Nothing new in the last 24 hours for releases");
});

it("/error explains a pasted error line or a function, and whether main has it", async () => {
  const line = (await run("error", { text: "[gpu] fatal: device does not support mesh shaders (code 3)" })).data.embeds[0];
  expect(line.description).toContain("[`abc1234`](https://github.com/acme/widgets/commit/abc1234def5678)");
  expect(line.fields).toEqual([
    {
      name: "Error: device does not support mesh shaders",
      value:
        "Still in today's source, at [Mesh.cpp:12](https://github.com/acme/widgets/blob/abc1234def5678/core/gpu/Mesh.cpp#L12) and 1 other place.\n" +
        "Games stopped by it: [Astro's Playroom](https://worker.test/compatibility/astro-playroom)",
      inline: false,
    },
  ]);
  const fn = (await run("error", { text: "unresolved import sceHttp2SendRequest" })).data.embeds[0].fields[0];
  expect(fn.name).toBe("sceHttp2SendRequest · Http2");
  expect(fn.value).toContain("❌ Not implemented on main yet");
  expect(fn.value).toContain("Named by 1 game: [Astro Bot](https://worker.test/compatibility/astro-bot)");
  // Part of a function name, and words of a message.
  expect((await run("error", { text: "Http2SendRequest" })).data.embeds[0].fields.map((f: any) => f.name)).toEqual(["sceHttp2SendRequest · Http2", "sceHttp2SendRequestAsync · Http2"]);
  expect((await run("error", { text: "scePadOpen" })).data.embeds[0].fields[0].value).toContain("✅ Implemented on main");
  expect((await run("error", { text: "buffer owner" })).data.embeds[0].fields[0].name).toBe("Error: guest buffer has no GPU owner");
  expect((await run("error", { text: "the moon is made of cheese" })).data).toMatchObject({ flags: 64, content: expect.stringContaining("Nothing in today's source matches") });
});

it("/setup gives every step, or one step's sections with links into the guide", async () => {
  const all = (await run("setup")).data.embeds[0];
  expect(all.fields.map((f: any) => f.name)).toEqual(["1. Check your PC", "2. Prepare your dump"]);
  expect(all.fields[0].value).toBe("A Vulkan GPU and Linux or Windows. [Read it](https://worker.test/docs/guide/requirements)");
  const one = (await run("setup", { step: "requirements" })).data.embeds[0];
  expect(one).toMatchObject({ title: "Step 1: Check your PC", url: "https://worker.test/docs/guide/requirements", footer: { text: "Next: /setup dump · Prepare your dump" } });
  expect(one.fields).toEqual([
    { name: "Graphics", value: "You need **Vulkan 1.1**. See [the FAQ](https://worker.test/faq).\n[More](https://worker.test/docs/guide/requirements#graphics)", inline: false },
  ]);
});

it("/games lists games at a stage or further, on the list or on one system", async () => {
  const menus = (await run("games", { stage: "Menus" })).data.embeds[0];
  expect(menus.title).toBe("2 games: Menus or further");
  expect(menus.description).toBe("[Astro's Playroom](https://worker.test/compatibility/astro-playroom) · Ingame\n[Astro Bot](https://worker.test/compatibility/astro-bot) · Menus");
  expect((await run("games", { stage: "Menus", gpu: "AMD" })).data.embeds[0]).toMatchObject({ title: "1 game: Menus or further on AMD", footer: { text: expect.stringContaining("on that system") } });
  expect((await run("games", { stage: "Starts", os: "linux" })).data.embeds[0].description).toBe("[Astro Bot](https://worker.test/compatibility/astro-bot) · Menus");
  expect((await run("games", { stage: "Playable" })).data.content).toBe("No games reach playable yet.");
});

it("/screenshot posts a community screenshot, and suggests only games that have one", async () => {
  const shot = (await run("screenshot")).data.embeds[0];
  expect(shot).toMatchObject({ title: "Astro Bot", image: { url: "https://worker.test/community/a1-full.webp" }, description: "Captured by **alice** · [See the post](https://github.com/acme/widgets/discussions/7#c1) · reported Menus" });
  expect((await run("screenshot", { game: "astro-playroom" })).data).toMatchObject({ flags: 64, content: expect.stringContaining("No screenshots of **Astro's Playroom** yet") });
  expect((await typing("screenshot", "game", "astro")).data.choices).toEqual([{ name: "Astro Bot · 1 screenshots", value: "astro-bot" }]);
});

it("/profile shows contributions and testing, by linked member or GitHub login", async () => {
  await addUser({ discord_id: "d1", github_id: 1, github_login: "alice" });
  const merge = (n: number, id: number, login: string, days: number) =>
    env.DB.prepare("INSERT INTO merges VALUES (?, ?, ?, ?, ?)").bind(n, `PR ${n}`, id, login, ago(days).slice(0, 19) + "Z").run();
  await merge(1, 1, "alice", 1);
  await merge(2, 1, "alice", 40);
  await merge(3, 2, "carol", 2);
  await merge(4, 2, "carol", 3);
  await merge(5, 2, "carol", 4);
  const mine = (await run("profile")).data.embeds[0];
  expect(mine).toMatchObject({ title: "alice", url: "https://github.com/alice", description: "<@d1>", thumbnail: { url: "https://github.com/alice.png?size=160" } });
  expect(mine.fields.map((f: any) => f.name)).toEqual(["Contributions", "Testing"]);
  expect(mine.fields[0].value).toContain("2 merged pull requests](<https://github.com/acme/widgets/pulls?q=");
  expect(mine.fields[0].value).toContain("#2 of 2 contributors\n1 in the last 30 days · 1 in the last 7");
  expect(mine.fields[1].value).toContain("**4 reports** on 3 games · #1 of 2 testers");
  // By login: a tester who isn't linked, and someone with only merges.
  expect((await run("profile", { github: "bob" })).data.embeds[0].fields.map((f: any) => f.name)).toEqual(["Testing"]);
  expect((await run("profile", { github: "carol" })).data.embeds[0].fields[0].value).toContain("#1 of 2 contributors");
  expect((await run("profile", { github: "nobody" })).data).toMatchObject({ flags: 64, content: "No merged pull requests or test reports from **nobody** yet." });
  expect((await run("profile", {}, "d2")).data).toMatchObject({ flags: 64, content: expect.stringContaining("You haven't linked a GitHub account") });
});
