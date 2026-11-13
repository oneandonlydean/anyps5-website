import { buildLabel, reportBuild, uploadBuild, type BuildData, type BuildInfo } from "./builds";
import type { Game } from "./resolve";
import type { Report } from "./schema";
import { stageRank, type StageOrNone } from "./stages";
import type { UploadSummary } from "./uploads";
import { reportKey } from "./view";

export interface ReportRow {
  /** Opens this result in the game page's report window. */
  key: string;
  href: string;
  date: string;
  stage: StageOrNone | null;
  os: string | null;
  gpuVendor: string | null;
  gpu: string | null;
  /** The build as the table shows it: a release, main after one, or what a branch build added. */
  build: string;
  /** The build was placed only by the result's date, so it may be a neighbouring release. */
  byDate: boolean;
  /** The build as the tester wrote it, or the upload's commit. */
  buildTitle: string | undefined;
  by: string | null;
  /** The uploaded run report's id; undefined for a Discussions report. */
  upload: number | undefined;
  /** The uploader said the run got this far, and that isn't confirmed yet. */
  stated: boolean;
  report?: Report;
  uploaded?: UploadSummary;
}

const BUILD_LABEL = { main: "main", prs: "main + PRs", patched: "patched", unknown: "—" } as const;

/**
 * A game's Discussions reports and uploaded run reports, newest first, in one list: the game page's report table and
 * its Markdown copy both read it.
 */
export function reportRows(game: Pick<Game, "reports" | "uploads" | "autoStage">, builds: BuildData): ReportRow[] {
  const firstRelease = builds.releases.at(-1)?.tag;
  const label = (info: BuildInfo) => buildLabel(info, firstRelease);
  return [
    ...game.reports.map((r) => ({
      key: reportKey(r),
      href: r.url,
      date: r.date,
      stage: r.stage,
      os: r.platform as string | null,
      gpuVendor: r.gpuVendor,
      gpu: r.gpu,
      // A main build is named by its release; one with pull requests or patches by what it added.
      build: r.buildKind === "main" || r.buildKind === "unknown" ? (r.build ? label(reportBuild(r, builds)) : BUILD_LABEL[r.buildKind]) : (BUILD_LABEL[r.buildKind] as string),
      byDate: (r.buildKind === "main" || r.buildKind === "unknown") && Boolean(r.build) && reportBuild(r, builds).basis === "date",
      buildTitle: r.build ?? undefined,
      by: r.author,
      upload: undefined,
      stated: false,
      report: r,
    })),
    ...game.uploads.map((u) => ({
      key: `u${u.id}`,
      href: `?report=u${u.id}`,
      date: u.at,
      stage: u.stage,
      os: u.os,
      gpuVendor: u.gpuVendor,
      gpu: u.gpu ?? null,
      build: label(uploadBuild(u, builds)),
      byDate: uploadBuild(u, builds).basis === "date",
      buildTitle: u.commit ?? undefined,
      by: u.login as string | null,
      upload: u.id,
      // A stage the tester stated stops being "unconfirmed" once it counts: a maintainer verified the run, or enough
      // reports reached it.
      stated: Boolean(u.stated) && !u.verifiedBy && !(game.autoStage?.confirmed && stageRank(game.autoStage.stage) >= stageRank(u.stage)),
      uploaded: u,
    })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
