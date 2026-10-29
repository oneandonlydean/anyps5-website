import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReport, RunReport } from "../src/lib/run-report";
import { autoStage, type UploadSummary } from "../src/lib/uploads";

const sample = () => JSON.parse(readFileSync(new URL("./fixtures/run-report.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-10-30T00:00:00Z");
const facts = { implemented: (name: string) => (name === "sceKernelOpen" ? true : name === "sceNpTrophyCreateContext" ? false : undefined), untranslated: new Set(["IMAGE_GATHER8H_PCK"]) };

describe("RunReport", () => {
  it("accepts the sample report", () => {
    expect(RunReport.safeParse(sample()).success).toBe(true);
  });

  it("rejects unknown fields, bad IDs and oversized lists", () => {
    expect(RunReport.safeParse({ ...sample(), extra: 1 }).success).toBe(false);
    expect(RunReport.safeParse({ ...sample(), game: { titleId: "PPSA1234" } }).success).toBe(false);
    const big = sample();
    big.missing.functions = Array.from({ length: 201 }, (_, i) => ({ library: "libc", name: `f${i}`, calls: 1 }));
    expect(RunReport.safeParse(big).success).toBe(false);
  });
});

describe("checkReport", () => {
  it("passes a consistent report", () => {
    expect(checkReport(RunReport.parse(sample()), facts, NOW)).toEqual({ errors: [], flags: [] });
  });

  it("refuses milestones that contradict the stage or each other", () => {
    const r = sample();
    r.run.stage = "starts";
    expect(checkReport(RunReport.parse(r), facts, NOW).errors).toContain("The firstDraw milestone is past the reported stage.");
    const s = sample();
    s.run.milestones.firstDraw = 0.5;
    expect(checkReport(RunReport.parse(s), facts, NOW).errors).toContain("Milestones are out of order.");
    const t = sample();
    t.generated = "2027-01-01T00:00:00Z";
    expect(checkReport(RunReport.parse(t), facts, NOW).errors).toContain("The report is dated in the future.");
  });

  it("flags claims that contradict upstream", () => {
    const r = sample();
    r.missing.functions.push({ library: "libkernel", name: "sceKernelOpen", calls: 1 });
    r.shaders.unsupported.push({ encoding: "VOP3", opcode: "V_ADD_F32", modifiers: [], count: 1 });
    const { errors, flags } = checkReport(RunReport.parse(r), facts, NOW);
    expect(errors).toEqual([]);
    expect(flags).toEqual([
      "Lists 1 missing function(s) that are implemented upstream: sceKernelOpen.",
      "Lists 1 unsupported instruction(s) the recompiler translates: V_ADD_F32.",
    ]);
  });
});

describe("autoStage", () => {
  const up = (githubId: number, stage: UploadSummary["stage"]) => ({ githubId, stage }) as UploadSummary;

  it("needs two accounts, or one plus a Discussions report", () => {
    expect(autoStage([up(1, "Presents")], null)).toEqual({ furthest: { stage: "Presents", confirmations: 1, confirmed: false }, confirmedStage: null });
    expect(autoStage([up(1, "Presents"), up(1, "Presents")], null).confirmedStage).toBeNull();
    expect(autoStage([up(1, "Presents"), up(2, "First draw")], null)).toEqual({ furthest: { stage: "Presents", confirmations: 1, confirmed: false }, confirmedStage: "First draw" });
    expect(autoStage([up(1, "Presents")], "Menus").confirmedStage).toBe("Presents");
    expect(autoStage([], "Menus")).toEqual({ furthest: null, confirmedStage: null });
  });
});
