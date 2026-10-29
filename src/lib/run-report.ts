import { z } from "zod";
import type { StageOrNone } from "./stages";

/**
 * The run report the AnyPS5 runtime writes after each run (anyps5-report.json; see docs/proposals/run-report.md).
 * The Worker validates uploads against this schema and the site build reads stored reports with it, so both agree on
 * what a report is. Unknown fields are rejected: a report is a fixed, small document, not free-form data.
 */

const text = (max = 300) => z.string().max(max);
const count = z.number().int().nonnegative();
const seconds = z.number().nonnegative().max(1e7);

export const RUN_STAGES = ["converts", "loads", "starts", "first-draw", "presents"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

/** A run report's stage as the compatibility list names it. */
export const SITE_STAGE: Record<RunStage, StageOrNone> = {
  converts: "Converts",
  loads: "Loads",
  starts: "Starts",
  "first-draw": "First draw",
  presents: "Presents",
};

export const RunReport = z
  .object({
    format: z.literal("anyps5-report"),
    version: z.literal(1),
    generated: z.iso.datetime(),
    anyps5: z.object({ commit: z.string().regex(/^[0-9a-f]{40}$/), release: text(40).nullable().optional(), modified: z.boolean() }).strict(),
    game: z
      .object({
        titleId: z.string().regex(/^(PPSA|CUSA)\d{5}$/),
        contentId: text(64).optional(),
        contentVersion: z
          .string()
          .regex(/^\d{2}\.\d{3}(\.\d{3})?$/)
          .optional(),
        name: text(120).optional(),
      })
      .strict(),
    system: z
      .object({
        os: z.enum(["linux", "windows", "macos"]),
        osVersion: text(120).optional(),
        cpu: text(120).optional(),
        ramGiB: z.number().int().positive().max(4096).optional(),
        gpu: z
          .object({
            vendor: z.enum(["AMD", "NVIDIA", "Intel", "Apple", "Other"]),
            name: text(120).optional(),
            driver: text(120).optional(),
            vulkan: text(20).optional(),
          })
          .strict(),
      })
      .strict(),
    run: z
      .object({
        seconds,
        exit: z.enum(["clean", "crash", "abort", "killed"]),
        stage: z.enum(RUN_STAGES),
        milestones: z.object({ loaded: seconds.optional(), started: seconds.optional(), firstDraw: seconds.optional(), firstPresent: seconds.optional() }).strict(),
        framesPresented: count.optional(),
        averageFps: z.number().nonnegative().max(1000).optional(),
      })
      .strict(),
    missing: z
      .object({ functions: z.array(z.object({ library: text(80), name: text(120), calls: count }).strict()).max(200) })
      .strict(),
    shaders: z
      .object({
        compiled: count,
        failed: count,
        unsupported: z.array(z.object({ encoding: text(16), opcode: text(64), modifiers: z.array(text(24)).max(16), count }).strict()).max(200),
        imageFormats: z.array(z.object({ format: count, name: text(64).optional(), supported: z.boolean(), count: count.optional() }).strict()).max(100),
        descriptors: z.array(z.object({ type: text(48), supported: z.boolean() }).strict()).max(100),
      })
      .strict(),
    stop: z
      .object({
        kind: z.enum(["none", "missing-function", "unsupported-shader", "unsupported-format", "crash", "assert", "other"]),
        message: text().optional(),
        source: text(200).optional(),
      })
      .strict(),
  })
  .strict();
export type RunReport = z.infer<typeof RunReport>;

/** Largest accepted file; the runtime keeps reports well under this. */
export const MAX_REPORT_BYTES = 64 * 1024;

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

const MILESTONE_FOR: Partial<Record<RunStage, keyof RunReport["run"]["milestones"]>> = {
  loads: "loaded",
  starts: "started",
  "first-draw": "firstDraw",
  presents: "firstPresent",
};

/**
 * Consistency checks beyond the schema. A report can't be proven genuine (the runtime is open source and runs on the
 * tester's machine), but one that contradicts itself or the source code is easy to spot.
 */
export function checkReport(report: RunReport, facts: UpstreamFacts, now = Date.now()): Check {
  const errors: string[] = [];
  const flags: string[] = [];
  const generated = Date.parse(report.generated);
  if (generated > now + 864e5) errors.push("The report is dated in the future.");
  if (generated < now - 180 * 864e5) errors.push("The report is more than 180 days old.");

  const { milestones } = report.run;
  const order: (keyof typeof milestones)[] = ["loaded", "started", "firstDraw", "firstPresent"];
  const reached = RUN_STAGES.indexOf(report.run.stage);
  for (const [stage, key] of Object.entries(MILESTONE_FOR) as [RunStage, keyof typeof milestones][]) {
    if (RUN_STAGES.indexOf(stage) <= reached && milestones[key] === undefined) errors.push(`Stage "${report.run.stage}" needs the ${key} milestone.`);
    if (RUN_STAGES.indexOf(stage) > reached && milestones[key] !== undefined) errors.push(`The ${key} milestone is past the reported stage.`);
  }
  const times = order.map((k) => milestones[k]).filter((t): t is number => t !== undefined);
  if (times.some((t, i) => i > 0 && t < times[i - 1]!)) errors.push("Milestones are out of order.");
  if (times.some((t) => t > report.run.seconds)) errors.push("A milestone is later than the end of the run.");
  if (report.run.stage === "presents" && !report.run.framesPresented) flags.push("Reached presents but reports no frames.");

  const implemented = report.missing.functions.filter((f) => facts.implemented(f.name) === true).map((f) => f.name);
  if (implemented.length) flags.push(`Lists ${implemented.length} missing function(s) that are implemented upstream: ${implemented.slice(0, 5).join(", ")}.`);
  const translated = facts.untranslated.size ? report.shaders.unsupported.filter((u) => !facts.untranslated.has(u.opcode.toUpperCase())).map((u) => u.opcode) : [];
  if (translated.length) flags.push(`Lists ${translated.length} unsupported instruction(s) the recompiler translates: ${translated.slice(0, 5).join(", ")}.`);
  if (report.stop.kind === "unsupported-shader" && report.shaders.unsupported.length === 0) flags.push("Stopped on a shader but lists no unsupported instruction.");
  if (report.anyps5.modified) flags.push("Built from modified AnyPS5 sources.");
  return { errors, flags };
}
