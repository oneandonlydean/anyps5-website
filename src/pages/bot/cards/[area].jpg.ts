import type { APIRoute } from "astro";
import { botData } from "../../../lib/bot-data";
import { atLeast, gameSeries } from "../../../lib/compat-history";
import { getGames } from "../../../lib/data";
import { loadGenerated } from "../../../lib/load";
import { AREA_LABEL, classify, type Merge, type MergeArea } from "../../../lib/merges";
import { boardImage, gamesImage, librariesImage, releaseImage, shadersImage, statsImage, trackedImage, wantedImage } from "../../../lib/og";
import { NOT_CONVERTING, STAGES, type StageOrNone } from "../../../lib/stages";
import { getCommits, getCompatHistory, getCoverage, getMergeBoard, getProgress } from "../../../lib/upstream";

/**
 * The pictures the Discord bot shows above its replies: /progress in depth, /stats, /leaderboard, /wanted, /tracked and
 * /release. A card whose data is missing is left out, and the command answers in text alone.
 */

const BIGGEST = 9;
const BOARD = 8;
const PERIODS = { all: "All time", month: "Last 30 days", week: "Last 7 days" } as const;
type Period = keyof typeof PERIODS;

export async function getStaticPaths() {
  const [progress, coverage, board, data] = await Promise.all([getProgress(), getCoverage(), getMergeBoard(), botData()]);
  const areas = [
    ...(progress ? ["libraries"] : []),
    ...(coverage?.instructions ? ["shaders"] : []),
    "games",
    ...(board ? ["stats", ...Object.keys(PERIODS).map((p) => `contributors-${p}`)] : []),
    ...Object.keys(PERIODS).map((p) => `testers-${p}`),
    ...(data.wanted.length ? ["wanted"] : []),
    ...(data.tracked?.games.length ? ["tracked"] : []),
    ...(data.release ? ["release"] : []),
  ];
  return areas.map((area) => ({ params: { area } }));
}

const today = () => new Date().toISOString().slice(0, 10);

export const GET: APIRoute = async ({ params }) => {
  const area = params.area!;
  const date = today();
  const data = await botData();

  if (area === "libraries") {
    const l = (await getProgress())!.libraries;
    const groups = l.groups.filter((g) => g.total > 0);
    const complete = groups.filter((g) => g.done === g.total).length;
    const started = groups.filter((g) => g.done > 0 && g.done < g.total).length;
    return librariesImage({
      date,
      done: l.done,
      total: l.total,
      complete,
      started,
      untouched: groups.length - complete - started,
      biggest: [...groups].sort((a, b) => b.total - a.total).slice(0, BIGGEST).map((g) => ({ name: g.label, done: g.done, total: g.total })),
    });
  }
  if (area === "shaders") {
    const c = (await getCoverage())!;
    return shadersImage({ date, instructions: c.instructions!, dpp: c.dpp, formats: c.formats, throws: { total: c.throws.total, areas: c.throws.areas } });
  }
  if (area === "games") {
    const [games, history] = await Promise.all([getGames(), getCompatHistory()]);
    const days = gameSeries(games, history, date).days;
    const now = days.at(-1)?.counts ?? {};
    const before = days.length > 7 ? days.at(-8)!.counts : null;
    const order: StageOrNone[] = [...STAGES.map((s) => s.name).reverse(), NOT_CONVERTING];
    return gamesImage({
      date,
      tested: atLeast(now, null),
      gameplay: atLeast(now, "Ingame"),
      week: before ? atLeast(now, "Ingame") - atLeast(before, "Ingame") : null,
      stages: order.map((stage) => ({ stage, count: now[stage] ?? 0 })),
    });
  }
  if (area === "stats") {
    const [board, commits] = await Promise.all([getMergeBoard(), getCommits()]);
    const t = data.testers.totals;
    const now = data.stages.now as Partial<Record<StageOrNone, number>>;
    return statsImage({
      date,
      merges: board && { total: board.totals.total, month: board.totals.month, people: board.totals.people, active: board.totals.active },
      testing: { reports: t.reports + t.uploads, month: t.month, testers: t.testers },
      games: { listed: data.games.length, gameplay: atLeast(now, "Ingame") },
      commits: (commits?.days ?? []).slice(-30),
    });
  }
  const board = area.match(/^(contributors|testers)-(all|month|week)$/);
  if (board) {
    const [, kind, period] = board as unknown as [string, "contributors" | "testers", Period];
    if (kind === "contributors") {
      const b = (await getMergeBoard())!;
      return boardImage({
        date,
        kind,
        period: PERIODS[period],
        total: b.totals[period === "all" ? "total" : period],
        noun: "merged pull requests",
        people: period === "all" ? b.totals.people : period === "month" ? b.totals.active : null,
        rows: b.boards[period].slice(0, BOARD).map((r) => ({ login: r.login, value: r[period === "all" ? "total" : period] })),
      });
    }
    const { totals, people } = data.testers;
    const value = (p: (typeof people)[number]) => (period === "all" ? p.reports + p.uploads : p[period]);
    const top = people.filter((p) => value(p) > 0).sort((a, b) => value(b) - value(a) || b.games - a.games || b.last.localeCompare(a.last));
    return boardImage({
      date,
      kind,
      period: PERIODS[period],
      total: period === "all" ? totals.reports + totals.uploads : totals[period],
      noun: "reports",
      people: period === "all" ? totals.testers : top.length,
      rows: top.slice(0, BOARD).map((p) => ({ login: p.login, value: value(p) })),
    });
  }
  if (area === "wanted") {
    return wantedImage({
      date,
      functions: data.wanted.map((w) => ({ name: w.name, library: w.library, games: w.games.length })),
      games: data.wantedGames,
    });
  }
  if (area === "tracked") {
    const t = data.tracked!;
    return trackedImage({ date, release: t.release, games: t.games.map((g) => ({ name: g.name, stage: g.stage })) });
  }
  // The release, and what was merged since the one before when the site's 30 days of merges reach back that far.
  const r = data.release!;
  const releases = await loadGenerated<{ tag: string; published: string; prerelease: boolean }[]>("releases.json", []);
  const previous = releases.filter((x) => !x.prerelease && x.published < r.published).sort((a, b) => b.published.localeCompare(a.published))[0];
  const { merges } = await loadGenerated<{ merges: Merge[] }>("merges.json", { merges: [] });
  const oldest = merges.reduce((min, m) => (m.mergedAt < min ? m.mergedAt : min), "9999");
  let since = null;
  if (previous && oldest <= previous.published) {
    const counts = new Map<MergeArea, number>();
    for (const m of merges) {
      if (m.mergedAt <= previous.published || m.mergedAt > r.published) continue;
      const c = classify(m);
      if (c.notable) counts.set(c.area, (counts.get(c.area) ?? 0) + 1);
    }
    since = { tag: previous.tag, areas: [...counts].sort((a, b) => b[1] - a[1]).map(([a, count]) => ({ label: AREA_LABEL[a], count })) };
  }
  const d = r.downloads;
  return releaseImage({
    tag: r.tag,
    published: r.published,
    downloads: [
      ...(d.linux ? [{ label: "Linux", size: d.linux.size }] : []),
      ...(d.windows ? [{ label: "Windows", size: d.windows.size }] : []),
    ],
    since,
  });
};
