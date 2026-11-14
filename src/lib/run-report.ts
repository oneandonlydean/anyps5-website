import { Validator } from "@cfworker/json-schema";
import schema from "./run-report/run-report.schema.json";
import type { StageOrNone } from "./stages";

/**
 * The run report the AnyPS5 runtime writes after each run (anyps5-report.json). The schema is upstream's, copied
 * unchanged from docs/run-report.schema.json (version 1, as of commit 449a777d on main, which added the optional
 * run.frameMs, shaders.compileMs and shaders.slowCompiles without changing the version), so the
 * Worker and the build accept exactly what the runtime writes. Every object in it is closed: a new field needs a new
 * copy of the schema. The validator is one that runs in Cloudflare Workers, where code generation isn't allowed.
 */

export const SCHEMA_COMMIT = "449a777d480f2f6e71324e4401d538be621ff2e8";

export type RunStage = "unknown" | "loads" | "starts" | "first-draw" | "presents";
type Text = string | null;

export interface RunReport {
  format: "anyps5-report";
  version: 1;
  generated: string;
  anyps5: { commit: Text; release: Text; modified: boolean | null };
  game: { titleId: Text; contentId: Text; contentVersion: Text; name: Text };
  system: {
    os: "linux" | "windows" | "macos" | null;
    osVersion: Text;
    cpu: Text;
    ramGiB: number | null;
    gpu: { vendor: "AMD" | "NVIDIA" | "Intel" | "Apple" | "Other" | null; name: Text; driver: Text; vulkan: Text } | null;
  };
  run: {
    id: string;
    seconds: number;
    exit: "clean" | "crash" | "abort" | "killed";
    exitCode: number | null;
    stage: RunStage;
    milestones: { loaded?: number; started?: number; firstDraw?: number; firstPresent?: number };
    framesPresented: number;
    averageFps: number | null;
    fpsWindowSeconds: number | null;
    /** Frame-time percentiles in ms over the last 2,048 intervals; null with under two frames. Added after v1 shipped. */
    frameMs?: { p50: number; p90: number; p99: number } | null;
    recovered: boolean;
    incomplete: boolean;
  };
  coverage: { milestones: boolean; missing: boolean; shaders: boolean; unsupported: boolean; imageFormats: boolean; descriptors: boolean };
  truncated: { functions: number; unsupported: number; imageFormats: number; descriptors: number };
  missing: { functions: { library: Text; name: string; calls: number }[] };
  shaders: {
    compiled: number;
    failed: number;
    cacheHits?: number;
    /** Total shader compile wall time in ms, and compiles over 100 ms; left out when shader coverage is off. */
    compileMs?: number;
    slowCompiles?: number;
    unsupported: { encoding: Text; opcode: Text; opcodeValue: number | null; modifiers: string[] | null; count: number }[];
    imageFormats: { format: number; name: Text; status: "accepted" | "rejected" | "unknown"; usage: string; count: number }[];
    descriptors: { type: string; status: "accepted" | "rejected" | "unknown"; usage: string; count: number }[];
  };
  stop: {
    kind: "none" | "missing-function" | "unsupported-shader" | "unsupported-format" | "crash" | "assert" | "other";
    reason: "guest-exit" | "quit-requested" | "runtime-stop" | "crash" | "unclean-unknown" | "other";
    message: string;
    source: Text;
  };
}

/** A run report's stage as the compatibility list names it; `unknown` puts the game on no stage. */
export const SITE_STAGE: Record<RunStage, StageOrNone | null> = {
  unknown: null,
  loads: "Loads",
  starts: "Starts",
  "first-draw": "First draw",
  presents: "Presents",
};

/** The whole file, in bytes of UTF-8; checked before parsing. */
export const MAX_REPORT_BYTES = 65_536;

const validator = new Validator(schema as object, "2020-12", false);

/** Validates parsed JSON against the schema. Returns the report, or up to five readable problems. */
export function validateRunReport(data: unknown): { report: RunReport; issues: [] } | { report: null; issues: string[] } {
  const result = validator.validate(data);
  if (result.valid) return { report: data as RunReport, issues: [] };
  // The validator reports every failing keyword up the tree; the deepest ones say what is actually wrong.
  const leaves = result.errors.filter((e) => !["properties", "allOf", "items", "$ref", "if", "then"].includes(e.keyword));
  const issues = [...new Set((leaves.length ? leaves : result.errors).map((e) => `${e.instanceLocation.replace(/^#\/?/, "") || "report"}: ${e.error}`))];
  return { report: null, issues: issues.slice(0, 5) };
}

/** What the checks know about upstream: which functions are implemented and which instructions are untranslated. */
export interface UpstreamFacts {
  implemented: (name: string) => boolean | undefined;
  untranslated: Set<string>;
}

export interface Check {
  /** Reasons to refuse the report outright. */
  errors: string[];
  /** Reasons a maintainer should look at it; the report is kept, but does not count until reviewed. */
  flags: string[];
}

const ORDER = ["loaded", "started", "firstDraw", "firstPresent"] as const;
const STAGE_MILESTONE: Record<RunStage, (typeof ORDER)[number] | null> = { unknown: null, loads: "loaded", starts: "started", "first-draw": "firstDraw", presents: "firstPresent" };

/**
 * Checks the schema can't express, which the runtime's own tests cover and asks validators to repeat: milestone
 * order, the stage matching its furthest milestone, and the frame rate matching frames over the measured window.
 * Then checks against upstream: a report can't be proven genuine (the runtime is open source and runs on the tester's
 * machine), but one that contradicts the source code is easy to spot. Lists a section's coverage says weren't
 * collected are never read as "nothing there".
 */
export function checkReport(report: RunReport, facts: UpstreamFacts, now = Date.now()): Check {
  const errors: string[] = [];
  const flags: string[] = [];
  const generated = Date.parse(report.generated);
  if (Number.isNaN(generated)) errors.push("The report's date can't be read.");
  else if (generated > now + 864e5) errors.push("The report is dated in the future.");
  else if (generated < now - 180 * 864e5) errors.push("The report is more than 180 days old.");

  const { milestones, stage } = report.run;
  const reached = ORDER.filter((k) => milestones[k] !== undefined);
  const times = reached.map((k) => milestones[k]!);
  if (times.some((t, i) => i > 0 && t < times[i - 1]!)) errors.push("Milestones are out of order.");
  if (times.some((t) => t > report.run.seconds)) errors.push("A milestone is later than the end of the run.");
  if ((reached.at(-1) ?? null) !== STAGE_MILESTONE[stage]) errors.push(`Stage "${stage}" doesn't match the furthest milestone.`);
  const { averageFps, fpsWindowSeconds, framesPresented } = report.run;
  if (averageFps !== null && fpsWindowSeconds) {
    const expected = framesPresented / fpsWindowSeconds;
    if (Math.abs(averageFps - expected) > Math.max(0.5, expected * 0.1)) errors.push("The average frame rate doesn't match the frames and the time measured.");
  }
  // Frame-time percentiles come from the intervals between presented frames, so they need two frames, and rise.
  const frameMs = report.run.frameMs;
  if (frameMs) {
    if (framesPresented < 2) errors.push("The report gives frame times for a run that presented fewer than two frames.");
    if (frameMs.p50 > frameMs.p90 || frameMs.p90 > frameMs.p99) errors.push("The frame-time percentiles are out of order.");
  }
  // Compile time is only measured with shader coverage on, and slow compiles are some of the compiles.
  const s = report.shaders;
  if (!report.coverage.shaders && (s.compileMs !== undefined || s.slowCompiles !== undefined)) errors.push("The report gives shader compile times, but shaders weren't collected.");
  if (s.slowCompiles !== undefined && s.slowCompiles > s.compiled + s.failed) errors.push("The report counts more slow shader compiles than compiles.");

  if (report.coverage.missing) {
    const implemented = report.missing.functions.filter((f) => facts.implemented(f.name) === true).map((f) => f.name);
    if (implemented.length) flags.push(`Lists ${implemented.length} missing function(s) that are implemented upstream: ${implemented.slice(0, 5).join(", ")}.`);
  }
  if (report.coverage.unsupported && facts.untranslated.size) {
    const translated = report.shaders.unsupported.filter((u) => u.opcode !== null && !facts.untranslated.has(u.opcode.toUpperCase())).map((u) => u.opcode!);
    if (translated.length) flags.push(`Lists ${translated.length} unsupported instruction(s) the recompiler translates: ${translated.slice(0, 5).join(", ")}.`);
  }
  if (report.anyps5.modified === true) flags.push("Built from modified AnyPS5 sources.");
  return { errors, flags };
}
