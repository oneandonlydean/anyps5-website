/**
 * Which build each result was on. Testers write the build as free text ("main 44a59edc3a, no pull requests"), so the
 * commit hash in it is looked up upstream (scripts/sync-builds.ts) for its date, and the date places it in a release:
 * the release itself, or main after it. A report naming no known commit falls back to a release named in the text, and
 * then to its own date.
 */
import { corrected, QUALIFYING } from "./resolve";
import type { Report } from "./schema";
import { stageRank, type StageOrNone } from "./stages";
import { autoStage, type UploadSummary } from "./uploads";

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

/** A release named in the text: the build is that release, or main after it when the text says "after", "since" or "newer". */
function byRelease(text: string | null, data: BuildData): BuildInfo | null {
  const match = (text ?? "").match(/\bv?(\d+\.\d+\.\d+)\b/);
  const release = match && data.releases.find((r) => r.tag.replace(/^v/, "") === match[1]);
  if (!release) return null;
  const after = /\b(after|since|newer|past|ahead)\b/i.test(text!.slice(0, match.index));
  return { release: release.tag, exact: !after, basis: "release" };
}

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
  return byRelease(report.build, data) ?? byDate(report.date, data);
}

export function uploadBuild(upload: Pick<UploadSummary, "commit" | "release" | "at">, data: BuildData): BuildInfo {
  const commit = upload.commit ? data.commits[upload.commit.toLowerCase()] : null;
  if (commit) return byCommit(commit, data);
  return byRelease(upload.release, data) ?? byDate(upload.at, data);
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
  /** The oldest and newest result here. */
  first: string;
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
export function testedOn(
  game: { reports: Report[]; uploads: UploadSummary[]; correction?: { stage: StageOrNone; date: string } | null },
  data: BuildData,
): Tested {
  // A maintainer's correction caps the reports it overruled.
  const reportStage = (r: Report & { stage: StageOrNone }) => corrected(r.stage, r.date, game.correction);
  const reports = game.reports.filter((r): r is Report & { stage: StageOrNone } => Boolean(r.stage) && QUALIFYING.has(r.buildKind));
  // How far a run got past presenting is the uploader's word, so it counts only as far as it is confirmed, and never
  // below the frames the run report itself recorded.
  const top = reports.reduce<(typeof reports)[number] | null>((t, r) => (stageRank(reportStage(r)) > stageRank(t ? reportStage(t) : null) ? r : t), null);
  const { confirmedStage } = autoStage(game.uploads, top ? { stage: reportStage(top), author: top.author } : null);
  const uploadStage = (u: UploadSummary) =>
    u.stated && stageRank(u.stated) > stageRank(confirmedStage) ? (stageRank(confirmedStage) > stageRank("Presents") ? confirmedStage! : "Presents") : u.stage;
  const results: BuildResult[] = [
    ...reports.map((r) => ({ date: r.date, stage: reportStage(r), build: reportBuild(r, data), source: "report" as const, url: r.url })),
    ...game.uploads.filter((u) => u.stage).map((u) => ({ date: u.at, stage: uploadStage(u)!, build: uploadBuild(u, data), source: "upload" as const, url: null })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const order = (release: string | null) => (release === null ? data.releases.length : data.releases.findIndex((r) => r.tag === release));
  const groups = Map.groupBy(results, (r) => r.build.release);
  const releases = [...groups.entries()]
    .map(([release, list]) => ({
      release,
      stage: list.reduce((top, r) => (stageRank(r.stage) > stageRank(top) ? r.stage : top), list[0]!.stage),
      results: list.length,
      first: list.at(-1)!.date,
      last: list[0]!.date,
      approximate: list.every((r) => r.build.basis === "date"),
    }))
    .sort((a, b) => order(a.release) - order(b.release));
  const was = releases[0] ? lowerThan(releases, 0) : null;
  return { releases, newest: results[0] ?? null, regression: was ? { was, now: releases[0]! } : null };
}

/**
 * The earlier release that got further than `releases[i]`, newest first: the best of all older ones, when it beat this
 * one. A release placed only by date isn't compared, as it may belong to a neighbour. The game page, the tracked games
 * and the feed all ask this, so they agree on what counts as lower.
 */
export function lowerThan(releases: ReleaseResult[], i: number): ReleaseResult | null {
  const now = releases[i]!;
  if (now.approximate) return null;
  const was = releases.slice(i + 1).reduce<ReleaseResult | null>((top, r) => (stageRank(r.stage) > stageRank(top?.stage) ? r : top), null);
  return was && stageRank(was.stage) > stageRank(now.stage) ? was : null;
}
