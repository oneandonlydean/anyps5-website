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

  it("adds games that only uploaded runs report", () => {
    const titles = { PPSA30001: { name: "Store Game™", region: "UP", concept: null }, PPSA00001: { name: "Game 1", region: "UP", concept: null } };
    const games = groupGames([thread(1, ["PPSA00001"])], [], titles, [
      { titleId: "PPSA30001", name: "Name in the report" },
      { titleId: "PPSA30002", name: "Homebrew Thing" },
      { titleId: "PPSA30003", name: null },
      { titleId: "PPSA00001", name: "Already listed" },
      { titleId: "not-an-id", name: "Nonsense" },
    ]);
    expect(games.map((g) => [g.name, g.slug, g.titleIds])).toEqual([
      ["Game 1", "game-1", ["PPSA00001"]],
      // The store's name wins over the report's; homebrew goes by the report's; an unlisted ID without a name is left out.
      ["Store Game", "store-game", ["PPSA30001"]],
      ["Homebrew Thing", "homebrew-thing", ["PPSA30002"]],
    ]);
  });

  it("joins an uploaded regional release to the game of the same name", () => {
    const titles = { PPSA00001: { name: "Game 1", region: "UP", concept: null }, PPSA00002: { name: "Game 1", region: "EP", concept: null } };
    const games = groupGames([thread(1, ["PPSA00001"])], [], titles, [{ titleId: "PPSA00002", name: null }]);
    expect(games.map((g) => g.titleIds)).toEqual([["PPSA00001", "PPSA00002"]]);
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

  it("lists the pull requests the branch-only stage needs, open ones first", () => {
    const pr = (number: number, state: string) => ({ number, kind: "pr", title: `PR ${number}`, state, url: `https://github.com/boykopovar/AnyPS5/pull/${number}` });
    const issues = { 7: pr(7, "merged"), 8: pr(8, "open"), 9: { ...pr(9, "open"), kind: "issue" } };
    const branch = report({ stage: "Ingame", buildKind: "patched", prs: [7, 8, 9, 404] });
    const game = resolveOne([thread(1, ["PPSA00001"], [report({ stage: "Starts" }), branch])], [], issues);
    expect(game.branch).toMatchObject({ url: branch.url, patched: true });
    expect(game.branch?.prs.map((p) => [p.number, p.state])).toEqual([[8, "open"], [7, "merged"]]);
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
    expect(one.autoStage).toEqual({ stage: "Presents", confirmations: 1, confirmed: false, verifiedBy: null });
    const two = resolveWith([upload(1, "Presents", "2026-10-20T00:00:00Z"), upload(2, "Presents", "2026-10-22T00:00:00Z")]);
    expect(two.stage).toBe("Presents");
    expect(two.timeline.at(-1)).toEqual({ date: "2026-10-22T00:00:00Z", stage: "Presents", url: null, source: "uploads" });
  });

  it("moves the stage on one upload a maintainer verified, from when it was uploaded", () => {
    const verified = resolveWith([{ ...upload(1, "Presents", "2026-10-20T00:00:00Z"), verifiedBy: "maintainer" } as never]);
    expect(verified.stage).toBe("Presents");
    expect(verified.autoStage).toEqual({ stage: "Presents", confirmations: 1, confirmed: true, verifiedBy: "maintainer" });
    expect(verified.timeline.at(-1)).toEqual({ date: "2026-10-20T00:00:00Z", stage: "Presents", url: null, source: "uploads" });
    // A verified upload confirms only as far as it got; a further unverified one still waits.
    const further = resolveWith([{ ...upload(1, "Presents", "2026-10-20T00:00:00Z"), verifiedBy: "maintainer" } as never, upload(2, "Ingame", "2026-10-21T00:00:00Z")]);
    expect(further.stage).toBe("Presents");
    expect(further.autoStage).toMatchObject({ stage: "Ingame", confirmed: false, verifiedBy: null });
  });

  it("drops art a maintainer hid", () => {
    expect(resolveWith([], ["PPSA00001:cover"]).art).toMatchObject({ cover: null, square: "s", hero: "h" });
  });
});
