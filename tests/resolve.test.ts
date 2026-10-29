import { describe, expect, it } from "vitest";
import type { NamedOverlay } from "../src/lib/load";
import { groupGames, resolveGame, slugify, threadName } from "../src/lib/resolve";
import type { Report, Thread } from "../src/lib/schema";

function report(overrides: Partial<Report>): Report {
  return {
    url: "https://github.com/boykopovar/AnyPS5/discussions/1",
    discussion: 1,
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
