import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { forgetSiteData, meter, type SiteData } from "../src/bot/site-data";
import worker from "../src/index";
import { ctx } from "./helpers";

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
  libraries: { done: 50, total: 200, groups: [{ name: "Pad", done: 10, total: 40 }, { name: "libkernel", done: 30, total: 60 }] },
  shaders: { decoded: 90, translated: 80, total: 100 },
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
  expect(report.flags).toBe(64);
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
});
