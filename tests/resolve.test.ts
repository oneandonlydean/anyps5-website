import { describe, expect, it } from "vitest";
import type { NamedOverlay } from "../src/lib/load";
import { groupGames, resolveGame, slugify, threadName } from "../src/lib/resolve";
import type { Report, Thread } from "../src/lib/schema";

function report(overrides: Partial<Report>): Report {
  return {
    url: "https://github.com/boykopovar/AnyPS5/discussions/1",
    discussion: 1,
    edited: null,
    author: "a",
    date: "2026-10-01T00:00:00Z",
    stage: "Starts",
    platform: "linux",
    gpu: null,
    gpuVendor: "AMD",
    build: "main",
    buildKind: "main",
    prs: [],
    version: null,
    shown: null,
    blockers: [],
    blockerText: null,
    ...overrides,
  };
}

function thread(number: number, ids: string[], reports: Report[] = []): Thread {
  return {
    number,
    title: `Game ${number} (${ids.join(", ")})`,
    url: `https://github.com/boykopovar/AnyPS5/discussions/${number}`,
    titleIds: ids,
    created: "2026-09-01T00:00:00Z",
    updated: "2026-10-01T00:00:00Z",
    comments: 0,
    reports,
    media: [],
  };
}

const overlay = (o: Partial<NamedOverlay>): NamedOverlay => ({ title_ids: ["PPSA00001"], aliases: [], tags: [], file: "x.yaml", ...o });
const resolveOne = (threads: Thread[], overlays: NamedOverlay[] = [], issues = {}) => resolveGame(groupGames(threads, overlays, {})[0], {}, issues, {});

describe("identity", () => {
  it("cleans names and slugs", () => {
    expect(threadName("Ghost of Yōtei (PPSA26344)")).toBe("Ghost of Yōtei");
    expect(slugify("Ghost of Yōtei®")).toBe("ghost-of-yotei");
  });

  it("merges threads joined by an overlay", () => {
    const games = groupGames([thread(1, ["PPSA00001"]), thread(2, ["PPSA00002"])], [overlay({ title_ids: ["PPSA00001", "PPSA00002"], name: "One" })], {});
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ name: "One", titleIds: ["PPSA00001", "PPSA00002"] });
  });

  it("merges regional releases that go by the same name", () => {
    const named = (n: number, title: string, id: string) => ({ ...thread(n, [id]), title: `${title} (${id})` });
    const titles = {
      PPSA21564: { name: "ASTRO BOT", region: "UP", concept: "10002684" },
      PPSA21567: { name: "ASTRO BOT", region: "EP", concept: "10002684" },
      PPSA00010: { name: "Some Game™", region: "UP", concept: null },
      PPSA00011: { name: "Different Name", region: "JP", concept: null },
    };
    const games = groupGames(
      [named(1, "Astro Bot", "PPSA21564"), named(2, "ASTRO BOT", "PPSA21567"), named(3, "Some Game", "PPSA00010"), named(4, "Some Game", "PPSA00011")],
      [],
      titles,
    );
    expect(games.map((g) => [g.name, g.slug, g.titleIds])).toEqual([
      ["Astro Bot", "astro-bot", ["PPSA21564", "PPSA21567"]],
      ["Some Game", "some-game", ["PPSA00010", "PPSA00011"]],
    ]);
    expect(resolveGame(games[0], titles, {}, {}).releases).toEqual([
      { titleId: "PPSA21564", region: "UP" },
      { titleId: "PPSA21567", region: "EP" },
    ]);
  });

  it("trusts thread names over store names and concepts", () => {
    const titles = {
      PPSA17221: { name: "Minecraft", region: "UP", concept: "1" },
      PPSA19639: { name: "Minecraft", region: "UP", concept: "1" },
      PPSA18194: { name: "METAL GEAR SOLID 4", region: "UP", concept: "2" },
      PPSA18216: { name: "METAL GEAR SOLID: Peace Walker", region: "UP", concept: "2" },
    };
    const games = groupGames(
      [
        { ...thread(1, ["PPSA19639"]), title: "Minecraft Preview (PPSA19639)" },
        { ...thread(2, ["PPSA17221"]), title: "Minecraft Bedrock (PPSA17221) runs on Windows" },
        { ...thread(3, ["PPSA18194"]), title: "METAL GEAR SOLID 4 (PPSA18194)" },
        { ...thread(4, ["PPSA18216"]), title: "METAL GEAR SOLID: Peace Walker (PPSA18216)" },
      ],
      [],
      titles,
    );
    expect(games).toHaveLength(4);
  });

  it("keeps a PS4 and a PS5 game with the same name apart", () => {
    const games = groupGames(
      [{ ...thread(1, ["CUSA04885"]), title: "Resident Evil 4 (CUSA04885)" }, { ...thread(2, ["PPSA06900"]), title: "Resident Evil 4 (PPSA06900)" }],
      [],
      {},
    );
    expect(games).toHaveLength(2);
  });
});

describe("stage", () => {
  it("takes the highest main-build report as the headline", () => {
    const game = resolveOne([thread(1, ["PPSA00001"], [report({ stage: "Starts" }), report({ stage: "Menus", date: "2026-10-02" })])]);
    expect(game.stage).toBe("Menus");
    expect(game.timeline.map((e) => e.stage)).toEqual(["Starts", "Menus"]);
  });

  it("shows branch-only progress separately", () => {
    const game = resolveOne([thread(1, ["PPSA00001"], [report({ stage: "Starts" }), report({ stage: "Ingame", buildKind: "prs" })])]);
    expect(game).toMatchObject({ stage: "Starts", branchStage: "Ingame" });
  });

  it("lets a curated stage win over older or lower reports", () => {
    const curated = { stage: "Converts" as const, date: "2026-10-05" };
    const game = resolveOne([thread(1, ["PPSA00001"], [report({ stage: "Menus", date: "2026-10-01" })])], [overlay({ curated })]);
    expect(game).toMatchObject({ stage: "Converts", verified: true });
  });

  it("lets a newer, higher main report overtake a curated stage", () => {
    const curated = { stage: "Starts" as const, date: "2026-10-01" };
    const game = resolveOne([thread(1, ["PPSA00001"], [report({ stage: "Menus", date: "2026-10-09T00:00:00Z" })])], [overlay({ curated })]);
    expect(game).toMatchObject({ stage: "Menus", verified: false });
  });

  it("lists only open blockers from the latest report that names any", () => {
    const issues = {
      5: { number: 5, kind: "issue", title: "Open", state: "open", url: "https://github.com/boykopovar/AnyPS5/issues/5" },
      6: { number: 6, kind: "pr", title: "Merged", state: "merged", url: "https://github.com/boykopovar/AnyPS5/pull/6" },
    } as const;
    const game = resolveOne([thread(1, ["PPSA00001"], [report({ blockers: [5, 6] })])], [], issues);
    expect(game.blockers.map((b) => b.number)).toEqual([5]);
  });
});

describe("threadName", () => {
  it("drops a repeated category prefix", () => {
    expect(threadName("Game bring-up: Dusklight (PPSA12345)")).toBe("Dusklight");
    expect(threadName("Bring up - Hades II (PPSA36082)")).toBe("Hades II");
    expect(threadName("Bringing up the rear (PPSA00001)")).toBe("Bringing up the rear");
  });
});

describe("uploads", () => {
  const upload = (githubId: number, stage: Report["stage"], at: string) =>
    ({ id: githubId, titleId: "PPSA00001", stage, login: `u${githubId}`, githubId, at, os: "linux", gpuVendor: "AMD", commit: "a".repeat(40), release: null, contentVersion: null, exit: "crash", missing: [], unsupported: [], stop: { kind: "none", message: null } }) as const;
  const resolveWith = (uploads: ReturnType<typeof upload>[], hidden: string[] = []) =>
    resolveGame(groupGames([thread(1, ["PPSA00001"], [report({ stage: "Starts" })])], [], {})[0]!, {}, {}, { PPSA00001: { checked: "", square: "s", cover: "c", hero: "h", logo: null, color: null, credits: [] } }, { uploads: uploads as never, hiddenArt: new Set(hidden) });

  it("shows one upload as pending, and moves the stage once a second account confirms it", () => {
    const one = resolveWith([upload(1, "Presents", "2026-10-20T00:00:00Z")]);
    expect(one.stage).toBe("Starts");
    expect(one.autoStage).toEqual({ stage: "Presents", confirmations: 1, confirmed: false });
    const two = resolveWith([upload(1, "Presents", "2026-10-20T00:00:00Z"), upload(2, "Presents", "2026-10-22T00:00:00Z")]);
    expect(two.stage).toBe("Presents");
    expect(two.timeline.at(-1)).toEqual({ date: "2026-10-22T00:00:00Z", stage: "Presents", url: null, source: "uploads" });
  });

  it("drops art a maintainer hid", () => {
    expect(resolveWith([], ["PPSA00001:cover"]).art).toMatchObject({ cover: null, square: "s", hero: "h" });
  });
});
