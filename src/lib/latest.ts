import { loadGenerated } from "./load";
import { AREA_LABEL, classify, type ClassifiedMerge, type Merge, type MergeArea } from "./merges";
import type { StageOrNone } from "./stages";
import { getCoverage, getProgressHistory } from "./upstream";
import { getUpdates, type Update } from "./updates";

/**
 * The home page's "Latest": headline events for a slider, and a timeline of the last few days that names what was
 * built, part by part, instead of only counting merges by area. Everything comes from the Updates feed and the daily
 * progress records, so the home page, /updates and the bot agree.
 */

/** A headline: a release, a game moving up, or a library starting, reaching half or completing. */
export interface Highlight {
  id: string;
  kind: "release" | "stage" | "library" | "regression";
  date: string;
  title: string;
  text: string;
  url: string;
  game?: Update["game"];
  stage?: StageOrNone;
  from?: StageOrNone;
  /** A game's first stage that really is its first report, not only its first on main. */
  first?: boolean;
  milestone?: Update["milestone"];
  library?: Update["library"];
}

export interface Change {
  number: number;
  summary: string;
  url: string;
  author: string | null;
}

/** What one part of AnyPS5 gained in a day: a system library, or the shader recompiler, GPU driver and so on. */
export interface Part {
  key: string;
  label: string;
  area: MergeArea;
  features: Change[];
  speedups: Change[];
  fixes: number;
}

export interface Day {
  /** A UTC day, YYYY-MM-DD. */
  date: string;
  /** Every pull request merged that day, tests, docs and tooling included, as GitHub counts them. */
  merged: number;
  /** Of those, by conventional-commit type, in any part of the project. */
  features: number;
  speedups: number;
  /** Library functions implemented that day, when the day's record and the one before exist. */
  functions: number | null;
  /** Shader instruction forms that newly decode. */
  shaderForms: number | null;
  events: Highlight[];
  /** The parts with features or speed-ups, most features first. User-facing parts only: tools and docs are left out. */
  parts: Part[];
  fixes: number;
}

const HIGHLIGHT_DAYS = 21;
const HIGHLIGHTS = 14;
/** Games in the slider: the newest results, however far back that reaches, so a quiet week still fills it. */
const GAME_SLIDES = 14;
const TIMELINE_DAYS = 4;

/** "libSceFreeType" → "FreeType", as the progress page names libraries; "libkernel" and "libc" stay as they are. */
export const libraryName = (scope: string) => scope.replace(/^libSce/, "");

/** A change's title as a sentence: no "type(scope):" prefix, a capital first letter, no trailing ellipsis. */
const sentence = (summary: string) => summary.replace(/…$/, "").replace(/^./, (c) => c.toUpperCase());

function partOf(m: ClassifiedMerge): { key: string; label: string } {
  if (m.area === "libraries" && m.library) return { key: `lib:${m.library.toLowerCase()}`, label: libraryName(m.library) };
  return { key: `area:${m.area}`, label: AREA_LABEL[m.area] };
}

function days(merges: ClassifiedMerge[]): Map<string, ClassifiedMerge[]> {
  const out = new Map<string, ClassifiedMerge[]>();
  // The same change merged twice (a re-opened pull request) is listed once.
  const seen = new Set<string>();
  for (const m of [...merges].sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))) {
    const day = m.mergedAt.slice(0, 10);
    const key = `${day}:${m.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(day, [...(out.get(day) ?? []), m]);
  }
  return out;
}

let cache: Promise<{ highlights: Highlight[]; games: Highlight[]; days: Day[] }> | undefined;

export function getLatest() {
  return (cache ??= build());
}

async function build() {
  const [updates, progress, coverage, mergeData] = await Promise.all([
    getUpdates(),
    getProgressHistory(),
    getCoverage(),
    loadGenerated<{ merges: Merge[] }>("merges.json", { merges: [] }),
  ]);
  // Every merge, for the day's totals; the parts below list only the user-facing ones.
  const allByDay = Map.groupBy(mergeData.merges.map((m) => classify(m)), (m) => m.mergedAt.slice(0, 10));
  const newest = updates[0]?.date ?? new Date().toISOString();
  const since = Date.parse(newest) - HIGHLIGHT_DAYS * 864e5;

  const toHighlight = (u: (typeof updates)[number]): Highlight => ({ id: u.id, kind: u.kind as Highlight["kind"], date: u.date, title: u.title, text: u.text, url: u.url, game: u.game, stage: u.stage, from: u.from, first: u.first, milestone: u.milestone, library: u.library });
  // Headline events of the last few weeks, which the timeline marks on their days.
  const highlights = updates
    .filter((u) => (u.kind === "release" || u.kind === "stage" || u.kind === "regression" || (u.kind === "library" && u.milestone !== "started")) && Date.parse(u.date) >= since)
    .slice(0, HIGHLIGHTS)
    .map(toHighlight);
  // The slider shows games only, chosen on their own rather than out of the events above.
  const games = updates.filter((u) => u.kind === "stage" || u.kind === "regression").slice(0, GAME_SLIDES).map(toHighlight);

  const merges = updates.flatMap((u) => (u.kind === "digest" ? (u.merges ?? []) : []));
  const byDay = days(merges);
  const functionDays = new Map(progress.map((d) => [d.date.slice(0, 10), d.libraries.done]));
  const shaderDays = new Map((coverage?.history ?? []).map((d) => [d.date.slice(0, 10), d.instructions?.decoded]));
  const delta = (series: Map<string, number | undefined>, day: string) => {
    const now = series.get(day);
    const before = [...series.keys()].filter((d) => d < day).sort().at(-1);
    const was = before ? series.get(before) : undefined;
    return now !== undefined && was !== undefined ? now - was : null;
  };

  const timeline: Day[] = [...byDay.keys()]
    .sort()
    .reverse()
    .slice(0, TIMELINE_DAYS)
    .map((date) => {
      const items = byDay.get(date)!;
      const all = allByDay.get(date) ?? items;
      const typed = (type: string) => all.filter((m) => m.type === type).length;
      const parts = new Map<string, Part>();
      for (const m of items) {
        const { key, label } = partOf(m);
        const part = parts.get(key) ?? { key, label, area: m.area, features: [], speedups: [], fixes: 0 };
        const change = { number: m.number, summary: sentence(m.summary), url: m.url, author: m.author };
        if (m.type === "feat") part.features.push(change);
        else if (m.type === "perf") part.speedups.push(change);
        else part.fixes++;
        parts.set(key, part);
      }
      return {
        date,
        merged: all.length,
        features: typed("feat"),
        speedups: typed("perf"),
        functions: delta(functionDays, date),
        shaderForms: delta(shaderDays, date),
        events: highlights.filter((h) => h.date.slice(0, 10) === date),
        parts: [...parts.values()]
          .filter((p) => p.features.length || p.speedups.length)
          // Parts outside the system libraries are rarer and tend to be bigger steps, so they lead on a tie.
          .sort((a, b) => b.features.length - a.features.length || b.speedups.length - a.speedups.length || Number(b.area !== "libraries") - Number(a.area !== "libraries")),
        fixes: typed("fix"),
      };
    });

  return { highlights, games, days: timeline };
}
