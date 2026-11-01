import { loadGenerated, loadOverlays } from "./load";
import { groupGames, resolveGame, type Game } from "./resolve";
import { matcher, type ErrorSite, type FunctionIndex, type Needs } from "./needs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Art, Issue, Report, Shot, Thread, Title } from "./schema";
import { gameScreenshots, type Screenshot } from "./screenshots";
import type { UploadExport } from "./uploads";

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
  return groupGames(threads, overlays, titles, community.uploads)
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

export interface Retest {
  /** The newest report's date, and how many releases have come out since. */
  lastTested: string | null;
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
    const [games, needs, issues, releases] = await Promise.all([
      getGames(),
      getNeeds(),
      loadGenerated<Record<number, Issue>>("issues.json", {}),
      loadGenerated<{ published: string }[]>("releases.json", []),
    ]);
    const newest = games.flatMap((g) => g.reports.map((r) => r.date)).sort().at(-1) ?? new Date().toISOString();
    const out = new Map<string, Retest>();
    for (const game of games) {
      const lastTested = game.reports[0]?.date ?? null;
      const releasesSince = lastTested ? releases.filter((r) => r.published > lastTested).length : 0;
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
