import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReport, MAX_REPORT_BYTES, validateRunReport, type RunReport } from "../src/lib/run-report";
import { autoStage, type UploadSummary } from "../src/lib/uploads";

const DIR = new URL("./fixtures/run-reports/", import.meta.url);
const FIXTURES = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const load = (name: string) => JSON.parse(readFileSync(new URL(name, DIR), "utf8"));
const report = (name: string) => validateRunReport(load(name)).report as RunReport;
const NOW = Date.parse("2026-10-30T00:00:00Z");
const facts = (untranslated: string[] = []) => ({
  implemented: (name: string) => (name === "sceNpTrophyCreateContext" ? true : undefined),
  untranslated: new Set(untranslated),
});

describe("the runtime's sample reports", () => {
  it.each(FIXTURES)("%s validates, fits the size limit and passes the extra checks", (name) => {
    const text = readFileSync(new URL(name, DIR), "utf8");
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    const { report: r, issues } = validateRunReport(JSON.parse(text));
    expect(issues).toEqual([]);
    expect(checkReport(r!, { implemented: () => undefined, untranslated: new Set() }, NOW).errors).toEqual([]);
  });

  it("covers every stop kind", () => {
    expect(new Set(FIXTURES.map((f) => load(f).stop.kind))).toEqual(new Set(["none", "missing-function", "unsupported-shader", "unsupported-format", "crash", "assert", "other"]));
  });
});

describe("validateRunReport", () => {
  it("rejects unknown fields and combinations the schema forbids, saying where", () => {
    const extra = { ...load("stop-none.json"), extra: 1 };
    expect(validateRunReport(extra).report).toBeNull();
    const mismatch = load("stop-none.json");
    mismatch.stop.reason = "runtime-stop";
    expect(validateRunReport(mismatch).report).toBeNull();
    const badId = load("stop-none.json");
    badId.game.titleId = "PPSA1234";
    expect(validateRunReport(badId).issues.join(" ")).toContain("game/titleId");
  });

  it("accepts the optional fields upstream added to version 1 later (frame times, compile time)", () => {
    const report = load("stop-none.json");
    report.run.frameMs = { p50: 16.7, p90: 33.4, p99: 120.5 };
    report.shaders.compileMs = 5321.5;
    report.shaders.slowCompiles = 12;
    expect(validateRunReport(report).issues).toEqual([]);
    report.run.frameMs = null;
    expect(validateRunReport(report).issues).toEqual([]);
    report.run.frameMs = { p50: 16.7 };
    expect(validateRunReport(report).issues.join(" ")).toContain("run/frameMs");
  });
});

describe("checkReport", () => {
  it("refuses frame and compile times that contradict the run", () => {
    const ok = report("stop-none.json");
    ok.run.frameMs = { p50: 16.7, p90: 20, p99: 40 };
    if (ok.run.framesPresented < 2) ok.run.frameMs = null;
    expect(checkReport(ok, facts(), NOW).errors.filter((e) => /frame times|percentiles|compile/.test(e))).toEqual([]);
    const few = report("zero-present.json");
    few.run.frameMs = { p50: 16.7, p90: 20, p99: 40 };
    expect(checkReport(few, facts(), NOW).errors).toContain("The report gives frame times for a run that presented fewer than two frames.");
    const order = report("stop-none.json");
    order.run.frameMs = { p50: 40, p90: 20, p99: 16 };
    expect(checkReport(order, facts(), NOW).errors).toContain("The frame-time percentiles are out of order.");
    const slow = report("stop-none.json");
    slow.coverage.shaders = true;
    slow.shaders.compileMs = 1000;
    slow.shaders.slowCompiles = slow.shaders.compiled + slow.shaders.failed + 1;
    expect(checkReport(slow, facts(), NOW).errors).toContain("The report counts more slow shader compiles than compiles.");
    const uncovered = report("stop-none.json");
    uncovered.coverage.shaders = false;
    uncovered.shaders.compileMs = 1000;
    expect(checkReport(uncovered, facts(), NOW).errors).toContain("The report gives shader compile times, but shaders weren't collected.");
  });

  it("refuses what the schema can't express: milestone order, stage, frame rate", () => {
    const order = report("stop-crash.json");
    order.run.milestones.firstDraw = 0.1;
    expect(checkReport(order, facts(), NOW).errors).toContain("Milestones are out of order.");
    const stage = report("stop-crash.json");
    stage.run.stage = "first-draw";
    expect(checkReport(stage, facts(), NOW).errors).toContain('Stage "first-draw" doesn\'t match the furthest milestone.');
    const fps = report("stop-crash.json");
    fps.run.averageFps = fps.run.averageFps! * 3;
    expect(checkReport(fps, facts(), NOW).errors).toContain("The average frame rate doesn't match the frames and the time measured.");
  });

  it("flags claims that contradict upstream, only where the section was collected", () => {
    expect(checkReport(report("stop-missing-function.json"), facts(), NOW).flags).toEqual([
      "Lists 1 missing function(s) that are implemented upstream: sceNpTrophyCreateContext.",
    ]);
    expect(checkReport(report("stop-unsupported-shader.json"), facts(["IMAGE_GATHER8H_PCK"]), NOW).flags).toEqual([
      "Lists 1 unsupported instruction(s) the recompiler translates: V_CVT_PK_U8_F32.",
    ]);
    const off = report("stop-missing-function.json");
    off.coverage.missing = false;
    expect(checkReport(off, facts(), NOW).flags).toEqual([]);
  });
});

describe("autoStage", () => {
  const up = (githubId: number, stage: UploadSummary["stage"]) => ({ githubId, stage, login: `u${githubId}` }) as UploadSummary;
  const discussion = (stage: UploadSummary["stage"], author = "someone-else") => ({ stage, author });

  it("needs two accounts, or one plus a Discussions report", () => {
    expect(autoStage([up(1, "Presents")], null)).toEqual({ furthest: { stage: "Presents", confirmations: 1, confirmed: false, verifiedBy: null }, confirmedStage: null });
    expect(autoStage([up(1, "Presents"), up(1, "Presents")], null).confirmedStage).toBeNull();
    expect(autoStage([up(1, "Presents"), up(2, "First draw")], null)).toEqual({ furthest: { stage: "Presents", confirmations: 1, confirmed: false, verifiedBy: null }, confirmedStage: "First draw" });
    expect(autoStage([up(1, "Presents")], discussion("Menus")).confirmedStage).toBe("Presents");
    expect(autoStage([], discussion("Menus"))).toEqual({ furthest: null, confirmedStage: null });
    expect(autoStage([up(1, null as never), up(2, null as never)], null)).toEqual({ furthest: null, confirmedStage: null });
  });

  it("counts one upload a maintainer verified, as far as it got", () => {
    const verified = { ...up(1, "First draw"), verifiedBy: "maintainer" };
    expect(autoStage([verified], null)).toEqual({ furthest: { stage: "First draw", confirmations: 1, confirmed: true, verifiedBy: "maintainer" }, confirmedStage: "First draw" });
    expect(autoStage([verified, up(2, "Presents")], null).confirmedStage).toBe("First draw");
  });

  it("doesn't let someone confirm their own upload with their own Discussions report", () => {
    expect(autoStage([up(1, "Presents")], discussion("Menus", "U1")).confirmedStage).toBeNull();
  });
});
