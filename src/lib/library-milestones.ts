/**
 * Per-library milestones. Upstream's history only has totals, so the site keeps its own record: the per-library counts
 * at the end of the previous day and the latest ones, plus the milestones found so far. The record is published with
 * the site (/library-history.json) and each data refresh starts from the published copy, so it survives CI runs.
 */

/** Library label → [implemented, declared]. */
export type LibraryCounts = Record<string, [number, number]>;

/**
 * - complete: every declared function is implemented.
 * - half: half or more are, for the first time.
 * - started: the first function is implemented.
 */
export type MilestoneKind = "complete" | "half" | "started";

export interface Milestone {
  date: string;
  library: string;
  kind: MilestoneKind;
  done: number;
  total: number;
}

export interface LibraryHistory {
  /** The counts at the end of the last day before `latest`, which today's milestones are measured from. */
  previous: { date: string; libraries: LibraryCounts } | null;
  latest: { date: string; libraries: LibraryCounts };
  milestones: Milestone[];
}

/** The milestone a library reached between two snapshots, if any; the biggest one wins. */
export function milestoneOf(before: [number, number] | undefined, after: [number, number]): MilestoneKind | null {
  const [done, total] = after;
  if (total === 0 || done === 0) return null;
  // A library new to the list counts as having nothing implemented before.
  const [doneBefore, totalBefore] = before ?? [0, 1];
  if (done === total && doneBefore < totalBefore) return "complete";
  if (done * 2 >= total && doneBefore * 2 < totalBefore) return "half";
  if (doneBefore === 0) return "started";
  return null;
}

/**
 * Records one data refresh. Several refreshes a day keep replacing that day's counts and milestones, which are always
 * measured from the end of the previous day, so a library that passes half and completes on one day reports once.
 * The first record has nothing to compare with, so it reports nothing.
 */
export function recordLibraries(history: LibraryHistory | null, date: string, libraries: LibraryCounts): LibraryHistory {
  if (!history) return { previous: null, latest: { date, libraries }, milestones: [] };
  if (date < history.latest.date) return history;
  const previous = date === history.latest.date ? history.previous : history.latest;
  const found: Milestone[] = [];
  if (previous) {
    for (const [library, counts] of Object.entries(libraries)) {
      const kind = milestoneOf(previous.libraries[library], counts);
      if (kind) found.push({ date, library, kind, done: counts[0], total: counts[1] });
    }
  }
  return {
    previous,
    latest: { date, libraries },
    milestones: [...history.milestones.filter((m) => m.date !== date), ...found],
  };
}
