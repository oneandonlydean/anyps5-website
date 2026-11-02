/**
 * Compatibility over time. A game's page only shows its own rises, so the site keeps a daily record of how many games
 * stand at each stage, published as /compat-history.json and read back by the next data refresh like the library
 * record (see library-milestones.ts). Days before the record started are rebuilt from the games' timelines.
 */
import { corrected } from "./resolve";
import { stageRank, type StageOrNone } from "./stages";

/** Stage → games at it. */
export type StageCounts = Partial<Record<StageOrNone, number>>;

export interface CompatDay {
  date: string;
  counts: StageCounts;
}

export interface CompatHistory {
  /** The last recorded day; the same as the last of `days`. */
  latest: CompatDay;
  /** Every recorded day, oldest first. */
  days: CompatDay[];
}

export function countStages(stages: (StageOrNone | null)[]): StageCounts {
  const counts: StageCounts = {};
  for (const stage of stages) if (stage) counts[stage] = (counts[stage] ?? 0) + 1;
  return counts;
}

/** Records one data refresh. Several refreshes a day keep replacing that day's counts. */
export function recordCompat(history: CompatHistory | null, date: string, stages: (StageOrNone | null)[]): CompatHistory {
  if (history && date < history.latest.date) return history;
  const latest = { date, counts: countStages(stages) };
  return { latest, days: [...(history?.days ?? []).filter((d) => d.date !== date), latest] };
}

/** Games at a stage or above it; "Not converting" counts only towards `tested`. */
export function atLeast(counts: StageCounts, stage: StageOrNone | null): number {
  return Object.entries(counts).reduce((n, [s, c]) => n + (stage === null || stageRank(s as StageOrNone) >= stageRank(stage) ? c : 0), 0);
}

/** Each game's furthest stage at the end of a day, from its timeline of rises. */
export function stagesOn(timelines: { date: string; stage: StageOrNone }[][], day: string): (StageOrNone | null)[] {
  return timelines.map((events) =>
    events.filter((e) => e.date.slice(0, 10) <= day).reduce<StageOrNone | null>((top, e) => (top === null || stageRank(e.stage) > stageRank(top) ? e.stage : top), null),
  );
}

/** Every day from `from` to `to`, inclusive, as YYYY-MM-DD. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/**
 * One count per day from the first report to `today`: the recorded day where there is one, else rebuilt from the
 * timelines. `rebuiltUntil` is the first recorded day, before which the counts are rebuilt.
 */
export function compatSeries(history: CompatHistory | null, timelines: { date: string; stage: StageOrNone }[][], today: string): { days: CompatDay[]; rebuiltUntil: string | null } {
  const first = timelines.flatMap((t) => t.map((e) => e.date.slice(0, 10))).sort()[0] ?? history?.days[0]?.date;
  if (!first) return { days: [], rebuiltUntil: null };
  const recorded = new Map((history?.days ?? []).map((d) => [d.date, d.counts]));
  const days = daysBetween(first, today).map((date) => ({ date, counts: recorded.get(date) ?? countStages(stagesOn(timelines, date)) }));
  const rebuiltUntil = history?.days[0]?.date ?? null;
  return { days, rebuiltUntil: rebuiltUntil && rebuiltUntil > first ? rebuiltUntil : null };
}

/**
 * The games' series as the site shows it: rebuilt days count the rises a maintainer's correction overruled at the
 * corrected stage, as recorded days do. The progress page and the Discord bot both use it.
 */
export function gameSeries(
  games: { timeline: { date: string; stage: StageOrNone }[]; correction: { stage: StageOrNone; date: string } | null }[],
  history: CompatHistory | null,
  today: string,
) {
  const timelines = games.map((g) => g.timeline.map((e) => ({ ...e, stage: corrected(e.stage, e.date, g.correction) })));
  return compatSeries(history, timelines, today);
}
