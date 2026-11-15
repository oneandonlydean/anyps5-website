import { loadGenerated, loadOverlays, loadTracked } from "./load";
import { groupGames, resolveGame, visibleThreads, type Game } from "./resolve";
import { matcher, type ErrorSite, type FunctionIndex, type Needs } from "./needs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Art, Issue, Report, Shot, Thread, Title } from "./schema";
import { gameScreenshots, type Screenshot } from "./screenshots";
import type { UploadExport } from "./uploads";
import { testedOn, type BuildData, type BuildInfo, type Tested } from "./builds";

/** Uploaded run reports and what maintainers hid, from the site Worker (scripts/sync-uploads.ts). */
export const getCommunity = () =>
  loadGenerated<UploadExport>("uploads.json", { generated: null, uploads: [], hidden: { screenshots: [], art: [] } });
import { stageRank } from "./stages";

let cache: Promise<Game[]> | undefined;

async function load(): Promise<Game[]> {
  const [threads, overlays, titles, issues, art, community] = await Promise.all([
    loadGenerated<Thread[]>("threads.json", []),
    loadOverlays(),
    loadGenerated<Record<string, Title>>("titles.json", {}),
    loadGenerated<Record<number, Issue>>("issues.json", {}),
    loadGenerated<Record<string, Art>>("art.json", {}),
    getCommunity(),
  ]);
  const extra = { uploads: community.uploads, hiddenArt: new Set(community.hidden.art) };
  return groupGames(visibleThreads(threads, community.uploads), overlays, titles, community.uploads)
    .map((identity) => resolveGame(identity, titles, issues, art, extra))
    .sort((a, b) => stageRank(b.stage) - stageRank(a.stage) || b.updated.localeCompare(a.updated));
}

export function getGames(): Promise<Game[]> {
  return (cache ??= load());
}

export interface GameNeeds extends Needs {
  /** The newest report with a blocker, which the needs were read from. */
  report: Report;
  /** The upstream commit the error sites were read at, for source links. */
  commit: string;
}

let needsCache: Promise<Map<string, GameNeeds>> | undefined;

/** What each game's newest blocker names, keyed by game slug. Games whose blocker names nothing known are left out. */
export function getNeeds(): Promise<Map<string, GameNeeds>> {
  return (needsCache ??= (async () => {
    const [games, functions, errors] = await Promise.all([
      getGames(),
      loadGenerated<FunctionIndex>("progress-functions.json", {}),
      loadGenerated<{ commit: string; sites: ErrorSite[] }>("error-sites.json", { commit: "main", sites: [] }),
    ]);
    const match = matcher(functions, errors.sites);
    const out = new Map<string, GameNeeds>();
    for (const game of games) {
      const report = game.reports.find((r) => r.blockerText);
      if (!report) continue;
      const needs = match.match(report.blockerText!);
      if (needs.functions.length || needs.errors.length) out.set(game.slug, { ...needs, report, commit: errors.commit });
    }
    return out;
  })());
}

let buildsCache: Promise<BuildData> | undefined;

/** Releases and the commits results were built from (scripts/sync-builds.ts); without them, releases are placed by date. */
export function getBuilds(): Promise<BuildData> {
  return (buildsCache ??= (async () => {
    const [data, releases] = await Promise.all([
      loadGenerated<BuildData | null>("builds.json", null),
      loadGenerated<{ tag: string; published: string; prerelease?: boolean }[]>("releases.json", []),
    ]);
    // releases.json lists every release; builds.json adds the commit each was cut from, when its lookup has been done.
    // One without a commit yet is placed by when it was published.
    const cut = new Map((data?.releases ?? []).map((r) => [r.tag, r]));
    const known = releases.length ? releases.filter((r) => !r.prerelease).map((r) => cut.get(r.tag) ?? { tag: r.tag, sha: "", date: r.published, published: r.published }) : (data?.releases ?? []);
    return { releases: known, commits: data?.commits ?? {} };
  })());
}

let testedCache: Promise<Map<string, Tested>> | undefined;

/** Each game's results by release, keyed by game slug. */
export function getTested(): Promise<Map<string, Tested>> {
  return (testedCache ??= Promise.all([getGames(), getBuilds()]).then(([games, builds]) => new Map(games.map((g) => [g.slug, testedOn(g, builds)]))));
}

/** The games in data/tracked.yaml, in its order; a title ID that matches no game is skipped. */
export async function getTrackedGames(): Promise<Game[]> {
  const [games, ids] = await Promise.all([getGames(), loadTracked()]);
  return [...new Set(ids.map((id) => games.find((g) => g.titleIds.includes(id))).filter((g): g is Game => Boolean(g)))];
}

export interface Retest {
  /** The newest result's date, the build it was on, and how many releases have come out since that build. */
  lastTested: string | null;
  lastBuild: BuildInfo | null;
  releasesSince: number;
  /** Old enough that the result probably no longer reflects the current build. */
  stale: boolean;
  /** What the newest blocker named that has been fixed since. */
  fixed: { functions: string[]; issues: Issue[] };
  /** Something it was waiting on is fixed and nothing it named is still open: worth running again. */
  ready: boolean;
}

/** Releases or days after which a result counts as stale. */
const STALE_RELEASES = 2;
const STALE_DAYS = 45;

let retestCache: Promise<Map<string, Retest>> | undefined;

export function getRetest(): Promise<Map<string, Retest>> {
  return (retestCache ??= (async () => {
    const [games, needs, issues, builds, tested] = await Promise.all([getGames(), getNeeds(), loadGenerated<Record<number, Issue>>("issues.json", {}), getBuilds(), getTested()]);
    const newest = games.flatMap((g) => [...g.reports.map((r) => r.date), ...g.uploads.map((u) => u.at)]).sort().at(-1) ?? new Date().toISOString();
    const out = new Map<string, Retest>();
    for (const game of games) {
      // The newest result's build, else the newest report's date (a result on a branch build, or with no stage).
      const last = tested.get(game.slug)!.newest;
      const lastTested = last?.date ?? game.reports[0]?.date ?? null;
      const lastBuild = last?.build ?? null;
      const index = lastBuild ? builds.releases.findIndex((r) => r.tag === lastBuild.release) : -1;
      const releasesSince = lastBuild ? (index === -1 ? builds.releases.length : index) : lastTested ? builds.releases.filter((r) => r.published > lastTested).length : 0;
      // Days are counted to the newest report anywhere, not to the build date, so a build from old data stays stable.
      const days = lastTested ? (Date.parse(newest) - Date.parse(lastTested)) / 864e5 : 0;

      const need = needs.get(game.slug);
      const report = game.reports.find((r) => r.blockers.length);
      const named = (report?.blockers ?? []).map((n) => issues[n]).filter((i): i is Issue => Boolean(i));
      // A closed issue or a merged pull request is a fix, if it landed after the report was last written: reports
      // often name pull requests that were merged before the run, or are edited to say so. A pull request closed without merging is not a fix.
      const isFix = (i: Issue) => (i.kind === "pr" ? i.state === "merged" : i.state === "closed") && Boolean(i.closedAt && report && i.closedAt > (report.edited ?? report.date));
      const fixed = {
        functions: need?.functions.filter((f) => f.status === "implemented").map((f) => f.name) ?? [],
        issues: named.filter(isFix),
      };
      const stillOpen = (need?.functions.some((f) => f.status !== "implemented") ?? false) || (need?.errors.length ?? 0) > 0 || named.some((i) => i.state === "open");
      out.set(game.slug, {
        lastTested,
        lastBuild,
        releasesSince,
        stale: Boolean(lastTested) && (releasesSince >= STALE_RELEASES || days > STALE_DAYS),
        fixed,
        ready: fixed.functions.length + fixed.issues.length > 0 && !stillOpen,
      });
    }
    return out;
  })());
}

let screenshotCache: Promise<Map<string, Screenshot[]>> | undefined;

/**
 * Each game's community screenshots, keyed by game slug. Only images whose WebP copies exist are listed, so a build
 * without `npm run sync:screenshots` simply has none.
 */
export function getScreenshots(): Promise<Map<string, Screenshot[]>> {
  return (screenshotCache ??= (async () => {
    const [games, shots, community] = await Promise.all([getGames(), loadGenerated<Record<string, Shot>>("screenshots.json", {}), getCommunity()]);
    // Maintainers can hide a screenshot (a duplicate, a poor capture); it is then left out like a missing file.
    const hidden = new Set(community.hidden.screenshots);
    const present = Object.fromEntries(
      Object.entries(shots).filter(([id]) => !hidden.has(id) && existsSync(resolve(process.cwd(), "public/community", `${id}-thumb.webp`))),
    );
    return new Map(games.map((game) => [game.slug, gameScreenshots(game.threads, present)]).filter(([, list]) => list.length > 0) as [string, Screenshot[]][]);
  })());
}
