import { describe, expect, it } from "vitest";
import { atLeast, compatSeries, recordCompat, stagesOn } from "../src/lib/compat-history";

describe("recordCompat", () => {
  it("keeps one count per day, replaced by later refreshes that day", () => {
    let history = recordCompat(null, "2026-11-01", ["Menus", "Starts", null]);
    expect(history.latest).toEqual({ date: "2026-11-01", counts: { Menus: 1, Starts: 1 } });
    history = recordCompat(history, "2026-11-01", ["Ingame", "Starts"]);
    history = recordCompat(history, "2026-11-02", ["Ingame", "Menus", "Not converting"]);
    expect(history.days).toEqual([
      { date: "2026-11-01", counts: { Ingame: 1, Starts: 1 } },
      { date: "2026-11-02", counts: { Ingame: 1, Menus: 1, "Not converting": 1 } },
    ]);
    expect(recordCompat(history, "2026-10-31", ["Playable"])).toBe(history);
  });
});

describe("atLeast", () => {
  it("counts games at a stage or above, and everything tested for null", () => {
    const counts = { Starts: 2, Menus: 1, Ingame: 3, "Not converting": 4 } as const;
    expect(atLeast(counts, "Menus")).toBe(4);
    expect(atLeast(counts, "Ingame")).toBe(3);
    expect(atLeast(counts, null)).toBe(10);
  });
});

describe("compatSeries", () => {
  const timelines = [
    [
      { date: "2026-10-01T10:00:00Z", stage: "Starts" as const },
      { date: "2026-10-03T10:00:00Z", stage: "Menus" as const },
    ],
    [{ date: "2026-10-02T23:00:00Z", stage: "Ingame" as const }],
  ];

  it("takes each game's furthest stage by the end of the day", () => {
    expect(stagesOn(timelines, "2026-10-02")).toEqual(["Starts", "Ingame"]);
    expect(stagesOn(timelines, "2026-09-30")).toEqual([null, null]);
  });

  it("rebuilds days before the record from the timelines and uses recorded days after", () => {
    const history = recordCompat(null, "2026-10-03", ["Playable", "Ingame"]);
    const { days, rebuiltUntil } = compatSeries(history, timelines, "2026-10-04");
    expect(days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(days[1]!.counts).toEqual({ Starts: 1, Ingame: 1 });
    expect(days[2]!.counts).toEqual({ Playable: 1, Ingame: 1 });
    expect(rebuiltUntil).toBe("2026-10-03");
  });
});
