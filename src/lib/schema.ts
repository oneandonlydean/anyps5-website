import { z } from "zod";
import { NOT_CONVERTING, STAGE_NAMES } from "./stages";

export const TITLE_ID = /^(PPSA|CUSA)\d{5}$/;

const stage = z.enum(STAGE_NAMES);
const stageOrNone = z.union([stage, z.literal(NOT_CONVERTING)]);
const artUrl = z.union([z.url(), z.null()]).optional();

export const Platform = z.enum(["linux", "windows", "macos"]);
export type Platform = z.infer<typeof Platform>;

export const BuildKind = z.enum(["main", "prs", "patched", "unknown"]);
export type BuildKind = z.infer<typeof BuildKind>;

/** A maintainer-written overlay in data/games/<slug>.yaml. Matched to threads by title ID. */
export const GameOverlay = z
  .object({
    name: z.string().min(1).optional(),
    title_ids: z.array(z.string().regex(TITLE_ID)).min(1),
    aliases: z.array(z.string()).default([]),
    kind: z.enum(["retail", "homebrew", "app"]).optional(),
    tags: z.array(z.string()).default([]),
    curated: z
      .object({
        stage: stageOrNone,
        date: z.iso.date(),
        platforms: z.partialRecord(Platform, stageOrNone).optional(),
        note: z.string().optional(),
        blockers: z.array(z.number().int().positive()).optional(),
        verified_by: z.string().optional(),
      })
      .strict()
      .optional(),
    art: z
      .object({ cover: artUrl, hero: artUrl, logo: artUrl, square: artUrl })
      .strict()
      .optional(),
  })
  .strict();
export type GameOverlay = z.infer<typeof GameOverlay>;

export const Report = z.object({
  url: z.url(),
  discussion: z.number(),
  author: z.string().nullable(),
  date: z.string(),
  stage: stageOrNone.nullable(),
  platform: Platform.nullable(),
  gpu: z.string().nullable(),
  gpuVendor: z.string().nullable(),
  build: z.string().nullable(),
  buildKind: BuildKind,
  prs: z.array(z.number()),
  version: z.string().nullable(),
  shown: z.string().nullable(),
  blockers: z.array(z.number()),
  /** The report's "current blocker" text, kept to match function names and error messages against progress data. */
  blockerText: z.string().nullable().default(null),
});
export type Report = z.infer<typeof Report>;

export const Thread = z.object({
  number: z.number(),
  title: z.string(),
  url: z.url(),
  titleIds: z.array(z.string().regex(TITLE_ID)),
  created: z.string(),
  updated: z.string(),
  comments: z.number(),
  reports: z.array(Report),
});
export type Thread = z.infer<typeof Thread>;

export const Issue = z.object({
  number: z.number(),
  kind: z.enum(["issue", "pr"]),
  title: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  url: z.url(),
});
export type Issue = z.infer<typeof Issue>;

export const Title = z.object({
  name: z.string(),
  region: z.string().nullable(),
  concept: z.string().nullable(),
});
export type Title = z.infer<typeof Title>;

export const Art = z.object({
  checked: z.string(),
  square: z.url().nullable(),
  cover: z.url().nullable(),
  hero: z.url().nullable(),
  logo: z.url().nullable(),
  color: z.string().nullable(),
  credits: z.array(z.enum(["PlayStation Store", "SteamGridDB"])),
});
export type Art = z.infer<typeof Art>;
