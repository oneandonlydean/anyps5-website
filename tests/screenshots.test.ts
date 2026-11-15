import { describe, expect, it } from "vitest";
import { caption, gameScreenshots, mediaId } from "../src/lib/screenshots";
import type { Report, Shot, Thread } from "../src/lib/schema";

const post = (n: number) => `https://github.com/boykopovar/AnyPS5/discussions/1#discussioncomment-${n}`;
const report = (n: number, stage: Report["stage"], date: string): Report => ({
  url: post(n),
  discussion: 1,
  edited: null,
  author: "tester",
  date,
  stage,
  platform: "linux",
  gpu: null,
  gpuVendor: "AMD",
  build: null,
  buildKind: "main",
  prs: [],
  version: null,
  shown: null,
  blockers: [],
  blockerText: null,
});
const media = (src: string, n: number, date: string) => ({ src, alt: "image", url: post(n), author: "tester", date });
const ok = (src: string): Shot => ({ src, width: 1920, height: 1080, color: "#112233" });

describe("gameScreenshots", () => {
  const thread: Thread = {
    number: 1,
    title: "Game (PPSA00001)",
    url: "https://github.com/boykopovar/AnyPS5/discussions/1",
    titleIds: ["PPSA00001"],
    created: "2026-10-01",
    updated: "2026-10-05",
    comments: 3,
    closedAt: null,
    reports: [report(1, "Menus", "2026-10-02"), report(2, "Ingame", "2026-10-03")],
    media: [
      media("https://e.com/menu.png", 1, "2026-10-02"),
      media("https://e.com/game.png", 2, "2026-10-03"),
      media("https://e.com/chat.png", 3, "2026-10-04"),
      media("https://e.com/broken.png", 3, "2026-10-04"),
      media("https://e.com/never-synced.png", 3, "2026-10-04"),
    ],
  };
  const shots: Record<string, Shot> = {
    [mediaId("https://e.com/menu.png")]: ok("https://e.com/menu.png"),
    [mediaId("https://e.com/game.png")]: ok("https://e.com/game.png"),
    [mediaId("https://e.com/chat.png")]: ok("https://e.com/chat.png"),
    [mediaId("https://e.com/broken.png")]: { src: "https://e.com/broken.png", skipped: "failed", checked: "2026-10-05" },
  };

  it("joins images to the report they were posted with, furthest stage first", () => {
    const list = gameScreenshots([thread], shots);
    expect(list.map((s) => [s.src.slice(14), s.stage])).toEqual([
      ["game.png", "Ingame"],
      ["menu.png", "Menus"],
      ["chat.png", null],
    ]);
    expect(list[0]).toMatchObject({ platform: "linux", gpuVendor: "AMD", width: 1920, color: "#112233" });
  });

  it("lists an image posted twice once", () => {
    const twice = { ...thread, media: [...thread.media, media("https://e.com/game.png", 4, "2026-10-06")] };
    expect(gameScreenshots([twice], shots).filter((s) => s.src.endsWith("game.png"))).toHaveLength(1);
  });
});

describe("mediaId", () => {
  it("is stable and file-name safe", () => {
    expect(mediaId("https://e.com/a.png")).toBe(mediaId("https://e.com/a.png"));
    expect(mediaId("https://e.com/a.png")).not.toBe(mediaId("https://e.com/b.png"));
    expect(mediaId("https://e.com/a.png")).toMatch(/^[0-9a-z]+$/);
  });
});

describe("caption", () => {
  it.each([
    ["image", null],
    ["Screenshot 2026-10-19 195751", null],
    ["Captura de pantalla_20261018_1", null],
    ["run1-10-automap-back.png", null],
    ["", null],
    ["{4D867433-FCEF-4259-B717-30446CAD249B}", null],
    ["Main menu", "Main menu"],
    ["Act 1, rings", "Act 1, rings"],
  ])("%j → %j", (alt, expected) => expect(caption(alt)).toBe(expected));
});
