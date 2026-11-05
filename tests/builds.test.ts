import { describe, expect, it } from "vitest";
import { buildLabel, commitIn, lowerThan, reportBuild, testedOn, uploadBuild, type BuildData } from "../src/lib/builds";
import type { Report } from "../src/lib/schema";
import type { UploadSummary } from "../src/lib/uploads";

const data: BuildData = {
  releases: [
    { tag: "v0.1.4", sha: "4".repeat(40), date: "2026-10-30T22:00:00Z", published: "2026-10-30T23:00:00Z" },
    { tag: "v0.1.3", sha: "3".repeat(40), date: "2026-10-20T07:00:00Z", published: "2026-10-20T09:00:00Z" },
  ],
  commits: {
    "44a59edc3a": { sha: "44a59edc3a" + "0".repeat(30), date: "2026-10-25T00:00:00Z" },
    "3333333aaa": { sha: "3".repeat(40), date: "2026-10-20T07:00:00Z" },
    "0a1d0000bc": { sha: "0".repeat(40), date: "2026-10-01T00:00:00Z" },
    deadbee1: null,
  },
};

function report(overrides: Partial<Report>): Report {
  return {
    url: "https://github.com/boykopovar/AnyPS5/discussions/1#r",
    discussion: 1,
    edited: null,
    author: "a",
    date: "2026-10-26T00:00:00Z",
    stage: "Menus",
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

describe("commitIn", () => {
  it("finds the first hash-like word with a digit and a letter", () => {
    expect(commitIn("main 44a59edc3a with #8847 (12223bf208).")).toBe("44a59edc3a");
    expect(commitIn("Unmodified main [AFF1F7190DBBE]")).toBe("aff1f7190dbbe");
    expect(commitIn("main, defaced, 2026-10-14, #12345678")).toBeNull();
    expect(commitIn(null)).toBeNull();
  });
});

describe("placing builds", () => {
  it("places a known commit as a release itself or main after one", () => {
    expect(reportBuild(report({ build: "main 3333333aaa" }), data)).toEqual({ release: "v0.1.3", exact: true, basis: "commit" });
    expect(reportBuild(report({ build: "main 44a59edc3a." }), data)).toEqual({ release: "v0.1.3", exact: false, basis: "commit" });
    expect(reportBuild(report({ build: "main 0a1d0000bc" }), data)).toEqual({ release: null, exact: false, basis: "commit" });
  });

  it("falls back to a release named in the text, then to the date", () => {
    expect(reportBuild(report({ build: "deadbee1 on 0.1.4" }), data)).toEqual({ release: "v0.1.4", exact: true, basis: "release" });
    expect(reportBuild(report({ build: "main", date: "2026-10-31T00:00:00Z" }), data)).toEqual({ release: "v0.1.4", exact: false, basis: "date" });
  });

  it("reads an upload's commit and release", () => {
    const upload = { commit: "44A59EDC3A", release: null, at: "2026-11-01T00:00:00Z" };
    expect(uploadBuild(upload, data)).toMatchObject({ release: "v0.1.3", basis: "commit" });
    expect(uploadBuild({ ...upload, commit: "ffffffff1", release: "v0.1.4" }, data)).toMatchObject({ release: "v0.1.4", exact: true });
  });

  it("names builds", () => {
    expect(buildLabel({ release: "v0.1.3", exact: true })).toBe("v0.1.3");
    expect(buildLabel({ release: "v0.1.3", exact: false })).toBe("main after v0.1.3");
    expect(buildLabel({ release: null, exact: false }, "v0.1.0")).toBe("main before v0.1.0");
  });
});

describe("testedOn", () => {
  const upload = (stage: UploadSummary["stage"], commit: string, at: string, extra: Partial<UploadSummary> = {}) =>
    ({ stage, commit, release: null, at, login: "u", githubId: 1, ...extra }) as UploadSummary;

  it("groups results by release, newest first, leaving out branch builds", () => {
    const tested = testedOn(
      {
        reports: [
          report({ build: "main 3333333aaa", stage: "Starts", date: "2026-10-21T00:00:00Z" }),
          report({ build: "main 44a59edc3a", stage: "Menus" }),
          report({ build: "main 44a59edc3a with #1", buildKind: "prs", stage: "Playable" }),
        ],
        uploads: [upload("Presents", "44a59edc3a", "2026-10-27T00:00:00Z", { id: 7 }), upload(null, "44a59edc3a", "2026-10-28T00:00:00Z")],
      },
      data,
    );
    expect(tested.releases).toEqual([{ release: "v0.1.3", stage: "Menus", results: 3, first: "2026-10-21T00:00:00Z", last: "2026-10-27T00:00:00Z", latest: "u7", approximate: false }]);
    expect(tested.newest).toMatchObject({ source: "upload", stage: "Presents" });
    expect(tested.regression).toBeNull();
  });

  it("flags a newer release that got less far, unless it was placed only by date", () => {
    const reports = [report({ build: "main 44a59edc3a", stage: "Menus" })];
    const lower = report({ build: "v0.1.4", stage: "Starts", date: "2026-10-31T00:00:00Z" });
    expect(testedOn({ reports: [...reports, lower], uploads: [] }, data).regression).toMatchObject({ was: { release: "v0.1.3", stage: "Menus" }, now: { release: "v0.1.4", stage: "Starts" } });
    expect(testedOn({ reports: [...reports, { ...lower, build: "main" }], uploads: [] }, data).regression).toBeNull();
  });
});

describe("testedOn and unconfirmed or overruled results", () => {
  const upload = (stated: UploadSummary["stage"], githubId: number) =>
    ({ stage: stated ?? "Presents", stated, commit: "44a59edc3a", release: null, at: "2026-10-27T00:00:00Z", login: `u${githubId}`, githubId }) as UploadSummary;

  it("counts an uploader's stated stage only once confirmed", () => {
    expect(testedOn({ reports: [], uploads: [upload("Playable", 1)] }, data).releases[0]!.stage).toBe("Presents");
    expect(testedOn({ reports: [], uploads: [upload("Playable", 1), upload("Ingame", 2)] }, data).releases[0]!.stage).toBe("Ingame");
    // Two say Menus and one of them Ingame too: the Ingame claim counts as the confirmed Menus, not below it.
    const tested = testedOn({ reports: [], uploads: [upload("Menus", 1), upload("Menus", 2), { ...upload("Ingame", 2), at: "2026-10-28T00:00:00Z" }] }, data);
    expect(tested.newest?.stage).toBe("Menus");
  });

  it("caps reports a maintainer's correction overruled", () => {
    const reports = [report({ build: "main 44a59edc3a", stage: "Ingame", date: "2026-10-26T00:00:00Z" })];
    expect(testedOn({ reports, uploads: [], correction: { stage: "Menus", date: "2026-10-28" } }, data).releases[0]!.stage).toBe("Menus");
    expect(testedOn({ reports, uploads: [], correction: { stage: "Menus", date: "2026-10-25" } }, data).releases[0]!.stage).toBe("Ingame");
  });
});

describe("release names and lower results", () => {
  it("reads 'after vX' as main after that release", () => {
    expect(reportBuild(report({ build: "main, newer than v0.1.3" }), data)).toEqual({ release: "v0.1.3", exact: false, basis: "release" });
    expect(reportBuild(report({ build: "the v0.1.3 download" }), data)).toEqual({ release: "v0.1.3", exact: true, basis: "release" });
  });

  it("calls a release lower against the best of every earlier one", () => {
    const r = (release: string, stage: Report["stage"], approximate = false) => ({ release, stage: stage!, results: 1, first: "", last: "", latest: "", approximate });
    const releases = [r("v0.1.4", "Menus"), r("v0.1.3", "Menus"), r("v0.1.2", "Starts"), r("v0.1.1", "Ingame")];
    expect(lowerThan(releases, 0)?.release).toBe("v0.1.1");
    expect(lowerThan(releases, 1)?.release).toBe("v0.1.1");
    expect(lowerThan(releases, 3)).toBeNull();
    expect(lowerThan([r("v0.1.4", "Menus", true), ...releases.slice(1)], 0)).toBeNull();
  });
});
