import { describe, expect, it } from "vitest";
import { milestoneOf, recordLibraries } from "../src/lib/library-milestones";

describe("milestoneOf", () => {
  it("finds the first function, half and completion", () => {
    expect(milestoneOf([0, 40], [3, 40])).toBe("started");
    expect(milestoneOf([10, 40], [20, 40])).toBe("half");
    expect(milestoneOf([30, 40], [40, 40])).toBe("complete");
  });

  it("reports only the biggest step", () => {
    expect(milestoneOf([0, 40], [40, 40])).toBe("complete");
    expect(milestoneOf([0, 40], [25, 40])).toBe("half");
  });

  it("treats a library new to the list as starting from nothing", () => {
    expect(milestoneOf(undefined, [2, 10])).toBe("started");
    expect(milestoneOf(undefined, [10, 10])).toBe("complete");
    expect(milestoneOf(undefined, [0, 10])).toBeNull();
  });

  it("ignores a library that was already there, or that newly declared functions push back below a line", () => {
    expect(milestoneOf([10, 10], [12, 12])).toBeNull();
    expect(milestoneOf([10, 10], [10, 12])).toBeNull();
    expect(milestoneOf([25, 40], [30, 40])).toBeNull();
    expect(milestoneOf([3, 40], [5, 40])).toBeNull();
  });
});

describe("recordLibraries", () => {
  it("reports nothing on the first record", () => {
    expect(recordLibraries(null, "2026-11-01", { libA: [5, 5] })).toEqual({ previous: null, latest: { date: "2026-11-01", libraries: { libA: [5, 5] } }, milestones: [] });
  });

  it("measures every refresh of a day from the end of the day before", () => {
    let history = recordLibraries(null, "2026-11-01", { libA: [10, 40], libB: [0, 8] });
    history = recordLibraries(history, "2026-11-02", { libA: [20, 40], libB: [0, 8] });
    expect(history.milestones).toEqual([{ date: "2026-11-02", library: "libA", kind: "half", done: 20, total: 40 }]);
    // Later the same day libA completes: one milestone for the day, the bigger one.
    history = recordLibraries(history, "2026-11-02", { libA: [40, 40], libB: [1, 8] });
    expect(history.previous?.date).toBe("2026-11-01");
    expect(history.milestones).toEqual([
      { date: "2026-11-02", library: "libA", kind: "complete", done: 40, total: 40 },
      { date: "2026-11-02", library: "libB", kind: "started", done: 1, total: 8 },
    ]);
    // The next day starts from the end of this one, and keeps earlier milestones.
    history = recordLibraries(history, "2026-11-03", { libA: [40, 40], libB: [4, 8] });
    expect(history.previous?.date).toBe("2026-11-02");
    expect(history.milestones.map((m) => `${m.date} ${m.library} ${m.kind}`)).toEqual(["2026-11-02 libA complete", "2026-11-02 libB started", "2026-11-03 libB half"]);
  });

  it("ignores a refresh older than the record", () => {
    const history = recordLibraries(null, "2026-11-02", { libA: [1, 4] });
    expect(recordLibraries(history, "2026-11-01", { libA: [4, 4] })).toBe(history);
  });
});
