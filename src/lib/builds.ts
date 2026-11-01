/**
 * Which build each result was on. Testers write the build as free text ("main 44a59edc3a, no pull requests"), so the
 * commit hash in it is looked up upstream (scripts/sync-builds.ts) for its date, and the date places it in a release:
 * the release itself, or main after it. A report naming no known commit falls back to a release named in the text, and
 * then to its own date.
 */
import { QUALIFYING } from "./resolve";
import type { Report } from "./schema";
import { stageRank, type StageOrNone } from "./stages";
import type { UploadSummary } from "./uploads";

export interface BuildData {
  /** Newest first: each release's tag, the commit it was cut from, that commit's date, and when it was published. */
  releases: { tag: string; sha: string; date: string; published: string }[];
  /** A commit hash as testers wrote it (lower case) → the full hash and its date, or null when upstream doesn't have it. */
  commits: Record<string, { sha: string; date: string } | null>;
}

export interface BuildInfo {
  /** The release the build is, or is newer than; null before the first release. */
  release: string | null;
  /** The build is that release itself rather than main after it. */
  exact: boolean;
  /** How it was worked out: a commit hash, a release named in the text, or only the date of the result. */
  basis: "commit" | "release" | "date";
}

/** The first thing in a build description that looks like a commit hash: 7 to 40 hex digits, with a digit and a letter. */
export function commitIn(text: string | null): string | null {
  for (const [token] of (text ?? "").matchAll(/\b[0-9a-f]{7,40}\b/gi)) if (/\d/.test(token) && /[a-f]/i.test(token)) return token.toLowerCase();
  return null;
}

const releaseIn = (text: string | null, data: BuildData) => {
  const named = (text ?? "").match(/\bv?(\d+\.\d+\.\d+)\b/)?.[1];
  return named ? data.releases.find((r) => r.tag.replace(/^v/, "") === named) : undefined;
};

function byCommit(commit: { sha: string; date: string }, data: BuildData): BuildInfo {
  const same = data.releases.find((r) => r.sha && r.sha === commit.sha);
  if (same) return { release: same.tag, exact: true, basis: "commit" };
  return { release: data.releases.find((r) => r.date <= commit.date)?.tag ?? null, exact: false, basis: "commit" };
}

const byDate = (date: string, data: BuildData): BuildInfo => ({ release: data.releases.find((r) => r.published <= date)?.tag ?? null, exact: false, basis: "date" });

export function reportBuild(report: Pick<Report, "build" | "date">, data: BuildData): BuildInfo {
  const hash = commitIn(report.build);
  const commit = hash ? data.commits[hash] : null;
  if (commit) return byCommit(commit, data);
  const release = releaseIn(report.build, data);
  if (release) return { release: release.tag, exact: true, basis: "release" };
  return byDate(report.date, data);
}

export function uploadBuild(upload: Pick<UploadSummary, "commit" | "release" | "at">, data: BuildData): BuildInfo {
  const commit = upload.commit ? data.commits[upload.commit.toLowerCase()] : null;
  if (commit) return byCommit(commit, data);
  const release = releaseIn(upload.release, data);
  if (release) return { release: release.tag, exact: true, basis: "release" };
  return byDate(upload.at, data);
}

export function buildLabel(info: Pick<BuildInfo, "release" | "exact">, first?: string): string {
  if (!info.release) return first ? `main before ${first}` : "main";
  return info.exact ? info.release : `main after ${info.release}`;
}

export interface BuildResult {
  date: string;
  stage: StageOrNone;
  build: BuildInfo;
  source: "report" | "upload";
  url: string | null;
}

/** A game's results on one release: the release itself and main up to the next one. */
export interface ReleaseResult {
  release: string | null;
  stage: StageOrNone;
  results: number;
  last: string;
  /** Every result here was placed only by its date, so it may belong to a neighbouring release. */
  approximate: boolean;
}

export interface Tested {
  /** Newest release first; releases without results are left out. */
  releases: ReleaseResult[];
  /** The newest result, for "last tested on". */
  newest: BuildResult | null;
  /** The newest release's furthest stage is below an earlier release's: a possible regression. */
  regression: { was: ReleaseResult; now: ReleaseResult } | null;
}

/**
 * A game's results by release, from Discussions reports on main and uploaded runs. Reports that needed open pull
 * requests or local patches are left out: they weren't on that release. Results whose stage is unknown say nothing.
 */
export function testedOn(game: { reports: Report[]; uploads: UploadSummary[] }, data: BuildData): Tested {
  const results: BuildResult[] = [
    ...game.reports.filter((r) => r.stage && QUALIFYING.has(r.buildKind)).map((r) => ({ date: r.date, stage: r.stage!, build: reportBuild(r, data), source: "report" as const, url: r.url })),
    ...game.uploads.filter((u) => u.stage).map((u) => ({ date: u.at, stage: u.stage!, build: uploadBuild(u, data), source: "upload" as const, url: null })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const order = (release: string | null) => (release === null ? data.releases.length : data.releases.findIndex((r) => r.tag === release));
  const groups = Map.groupBy(results, (r) => r.build.release);
  const releases = [...groups.entries()]
    .map(([release, list]) => ({
      release,
      stage: list.reduce((top, r) => (stageRank(r.stage) > stageRank(top) ? r.stage : top), list[0]!.stage),
      results: list.length,
      last: list[0]!.date,
      approximate: list.every((r) => r.build.basis === "date"),
    }))
    .sort((a, b) => order(a.release) - order(b.release));
  const [now, ...earlier] = releases;
  const was = earlier.reduce<ReleaseResult | null>((top, r) => (stageRank(r.stage) > stageRank(top?.stage) ? r : top), null);
  const regression = now && was && !now.approximate && stageRank(was.stage) > stageRank(now.stage) ? { was, now } : null;
  return { releases, newest: results[0] ?? null, regression };
}
