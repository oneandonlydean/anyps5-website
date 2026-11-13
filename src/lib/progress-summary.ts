import type { Game } from "./resolve";
import { stageRank } from "./stages";
import type { ProgressDay } from "./upstream";

const DAY = 864e5;

export interface PaceRow {
  label: string;
  /** This week; null when the data to count it is missing. */
  now: number | null;
  before: number | null;
}

/**
 * This week against the week before: what is being done, not only where things stand. Weeks end on `today`. The
 * progress page and its Markdown copy both show it.
 */
export function weeklyPace(games: Game[], libraryHistory: ProgressDay[], today: string): PaceRow[] {
  const end = Date.parse(`${today}T23:59:59Z`);
  const week = (iso: string) => Math.floor((end - Date.parse(iso)) / (7 * DAY));
  const results = games.flatMap((g) => [...g.reports.map((r) => ({ date: r.date, by: r.author })), ...g.uploads.map((u) => ({ date: u.at, by: u.login }))]);
  const firstIngame = games.flatMap((g) => g.timeline.find((e) => stageRank(e.stage) >= stageRank("Ingame"))?.date ?? []);
  const functionsAt = (days: number) => libraryHistory.filter((d) => Date.parse(d.date) <= end - days * DAY).at(-1)?.libraries.done;
  const functionsGained = (from: number, to: number) => {
    const [a, b] = [functionsAt(to), functionsAt(from)];
    return a === undefined || b === undefined ? null : b - a;
  };
  return [
    { label: "Test results", now: results.filter((r) => week(r.date) === 0).length, before: results.filter((r) => week(r.date) === 1).length },
    {
      label: "Testers",
      now: new Set(results.filter((r) => week(r.date) === 0).map((r) => r.by)).size,
      before: new Set(results.filter((r) => week(r.date) === 1).map((r) => r.by)).size,
    },
    { label: "Games newly in game", now: firstIngame.filter((d) => week(d) === 0).length, before: firstIngame.filter((d) => week(d) === 1).length },
    { label: "Functions implemented", now: functionsGained(0, 7), before: functionsGained(7, 14) },
  ];
}
