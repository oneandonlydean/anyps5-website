import { stageRank, type StageOrNone } from "./stages";

/** One uploaded run report, as the site Worker exports it (see worker/src/site/reports.ts). Null means unknown. */
export interface UploadSummary {
  id: number;
  titleId: string;
  /** The report had no title ID; the uploader chose the game. */
  titleChosen: boolean;
  /** The compatibility list's stage, or null when the run's stage is unknown. */
  stage: StageOrNone | null;
  login: string;
  githubId: number;
  at: string;
  os: string | null;
  gpuVendor: string | null;
  commit: string | null;
  release: string | null;
  contentVersion: string | null;
  exit: string;
  /** Written at the next start for a run that ended uncleanly. */
  recovered: boolean;
  /** Top entries of each list; null when the runtime didn't collect that section in this run. */
  missing: string[] | null;
  unsupported: string[] | null;
  truncated: { functions: number; unsupported: number };
  stop: { kind: string; reason: string; message: string };
}

export interface UploadExport {
  generated: string | null;
  uploads: UploadSummary[];
  hidden: { screenshots: string[]; art: string[] };
}

export interface AutoStage {
  /** The furthest stage any upload reached. */
  stage: StageOrNone;
  /** Distinct accounts whose uploads reached it, plus one if a Discussions report did too. */
  confirmations: number;
  /** Two confirmations: enough to count toward the game's stage. */
  confirmed: boolean;
}

/** Confirmations needed before uploads move a game's stage. */
export const CONFIRMATIONS_NEEDED = 2;

/**
 * Where a game's uploads put it. A stage counts once two different accounts reached it, or one account and a
 * Discussions report did; the furthest such stage is confirmed. The furthest stage reached at all is shown as
 * pending with its confirmation count.
 */
export function autoStage(
  uploads: UploadSummary[],
  discussion: { stage: StageOrNone | null; author: string | null } | null,
): { furthest: AutoStage | null; confirmedStage: StageOrNone | null } {
  // A run whose stage is unknown says nothing about how far the game gets.
  const staged = uploads.filter((u): u is UploadSummary & { stage: StageOrNone } => u.stage !== null);
  if (!staged.length) return { furthest: null, confirmedStage: null };
  // Someone can't confirm their own upload with their own Discussions report.
  const uploaders = new Set(staged.map((u) => u.login.toLowerCase()));
  const discussionStage = discussion && !(discussion.author && uploaders.has(discussion.author.toLowerCase())) ? discussion.stage : null;
  const confirmationsAt = (stage: StageOrNone) =>
    new Set(staged.filter((u) => stageRank(u.stage) >= stageRank(stage)).map((u) => u.githubId)).size + (stageRank(discussionStage) >= stageRank(stage) ? 1 : 0);
  const stages = [...new Set(staged.map((u) => u.stage))].sort((a, b) => stageRank(b) - stageRank(a));
  const top = stages[0]!;
  const confirmedStage = stages.find((s) => confirmationsAt(s) >= CONFIRMATIONS_NEEDED) ?? null;
  return { furthest: { stage: top, confirmations: confirmationsAt(top), confirmed: confirmedStage === top }, confirmedStage };
}
