import { getGames } from "./data";
import { loadGenerated } from "./load";
import { AREA_LABEL, AREAS, classify, typeLabel, type ClassifiedMerge, type Merge, type MergeArea } from "./merges";
import { stageRank, type StageOrNone } from "./stages";
import { getCoverage, getLibraryHistory, getProgressHistory } from "./upstream";
import type { MilestoneKind } from "./library-milestones";

/**
 * - stage: a game reached a new stage.
 * - release: a new upstream release.
 * - merge: one user-facing pull request merged upstream (a feature, fix or speed-up).
 * - digest: one day of merges, with what the libraries and shader recompiler gained.
 * - week: a weekly progress summary, for weeks before the merge history starts.
 * - library: a system library got its first implemented function, reached half, or was completed.
 */
export type UpdateKind = "stage" | "release" | "merge" | "digest" | "week" | "library";

/** Which feed and page tab an update belongs to. */
export const CATEGORY: Record<UpdateKind, "games" | "releases" | "progress"> = {
  stage: "games",
  release: "releases",
  merge: "progress",
  digest: "progress",
  week: "progress",
  library: "progress",
};

export interface Update {
  /** Stable across builds, for feed entry IDs. */
  id: string;
  date: string;
  kind: UpdateKind;
  title: string;
  text: string;
  url: string;
  game?: { slug: string; name: string; cover: string | null; color: string | null };
  stage?: StageOrNone;
  /** On a stage rise: the stage the game came up from. */
  from?: StageOrNone;
  /** On a merge: what it changed, and who made it. */
  merge?: { area: MergeArea; type: string; library: string | null; author: string | null; number: number };
  /** On a digest: the day's merges by area, for the page to list. */
  merges?: ClassifiedMerge[];
  /** On a library milestone: which one. */
  milestone?: MilestoneKind;
}

interface ReleaseEntry {
  tag: string;
  name: string;
  url: string;
  published: string;
  prerelease: boolean;
}

const number = new Intl.NumberFormat("en-GB");
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${number.format(Math.abs(n))}`;

/** The Monday that starts a date's week, as YYYY-MM-DD. */
function weekOf(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The last entry of each week in a dated series, oldest first. */
function weekly<T extends { date: string }>(series: T[]): Map<string, T> {
  const weeks = new Map<string, T>();
  for (const entry of series) weeks.set(weekOf(entry.date), entry);
  return weeks;
}

let cache: Promise<Update[]> | undefined;

/** Stage rises, releases, merges and progress digests, newest first. Everything is derived from data the site already has. */
export function getUpdates(): Promise<Update[]> {
  return (cache ??= build());
}

async function build(): Promise<Update[]> {
  const [games, releases, libraries, coverage, mergeData, libraryHistory] = await Promise.all([
    getGames(),
    loadGenerated<ReleaseEntry[]>("releases.json", []),
    getProgressHistory(),
    getCoverage(),
    loadGenerated<{ merges: Merge[] }>("merges.json", { merges: [] }),
    getLibraryHistory(),
  ]);
  const updates: Update[] = [];
  const gameCard = (g: (typeof games)[number]) => ({ slug: g.slug, name: g.name, cover: g.art?.cover ?? g.art?.square ?? null, color: g.art?.color ?? null });
  const byTitleId = new Map(games.flatMap((g) => g.titleIds.map((id) => [id, g] as const)));

  for (const g of games) {
    const game = gameCard(g);
    g.timeline.forEach((event, i) => {
      const previous = g.timeline[i - 1];
      updates.push({
        id: `stage:${g.slug}:${event.stage}`,
        date: event.date,
        kind: "stage",
        title: previous ? `${g.name} reaches ${event.stage}` : `${g.name} first tested: ${event.stage}`,
        text: previous ? `Up from ${previous.stage}.` : "Its first test report.",
        url: `/compatibility/${g.slug}`,
        game,
        stage: event.stage,
        from: previous?.stage,
      });
    });
  }

  for (const r of releases) {
    updates.push({
      id: `release:${r.tag}`,
      date: r.published,
      kind: "release",
      title: `AnyPS5 ${r.name || r.tag} released`,
      text: r.prerelease ? "A pre-release build." : "A new release of the relinker, the converter and the system libraries.",
      url: r.url,
    });
  }

  // Every user-facing merge, and one digest per day of merges with what the libraries and shader recompiler gained.
  const merges = mergeData.merges.map((m) => classify(m)).filter((m) => m.notable);
  for (const m of merges) {
    const game = m.titleIds.map((id) => byTitleId.get(id)).find(Boolean);
    updates.push({
      id: `merge:${m.number}`,
      date: m.mergedAt,
      kind: "merge",
      title: `${m.library ?? AREA_LABEL[m.area]}: ${m.summary}`,
      text: `${typeLabel(m.type)}, ${AREA_LABEL[m.area]}${m.author ? `, by ${m.author}` : ""} (#${m.number}).${game ? ` Affects ${game.name}.` : ""}`,
      url: m.url,
      game: game ? gameCard(game) : undefined,
      merge: { area: m.area, type: m.type, library: m.library, author: m.author, number: m.number },
    });
  }
  const libraryDays = new Map(libraries.map((d) => [d.date.slice(0, 10), d]));
  const shaderDays = new Map((coverage?.history ?? []).map((d) => [d.date.slice(0, 10), d]));
  const before = <T>(days: Map<string, T>, day: string) => [...days.keys()].filter((d) => d < day).sort().at(-1);
  for (const [day, items] of Object.entries(Object.groupBy(merges, (m) => m.mergedAt.slice(0, 10))) as [string, ClassifiedMerge[]][]) {
    const counts = AREAS.map((a) => [a, items.filter((m) => m.area === a).length] as const).filter(([, n]) => n > 0);
    const parts = [counts.map(([a, n]) => `${AREA_LABEL[a]} ${number.format(n)}`).join(" · ")];
    const lib = libraryDays.get(day);
    const libBefore = libraryDays.get(before(libraryDays, day) ?? "");
    if (lib && libBefore && lib.libraries.done !== libBefore.libraries.done) parts.push(`${signed(lib.libraries.done - libBefore.libraries.done)} library functions implemented`);
    const sh = shaderDays.get(day);
    const shBefore = shaderDays.get(before(shaderDays, day) ?? "");
    if (sh && shBefore && sh.throws !== shBefore.throws) parts.push(`unsupported shader cases ${number.format(shBefore.throws)} → ${number.format(sh.throws)}`);
    updates.push({
      id: `digest:${day}`,
      date: items[0].mergedAt,
      kind: "digest",
      title: `Progress on ${new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}: ${number.format(items.length)} changes merged`,
      text: `${parts.join(". ")}.`,
      url: "/updates#progress",
      merges: items,
    });
  }
  // Libraries that got their first function, reached half or were completed, as the site's own record found them.
  for (const m of libraryHistory?.milestones ?? []) {
    const counts = `${number.format(m.done)} of ${number.format(m.total)} functions`;
    updates.push({
      id: `library:${m.date}:${m.library}`,
      date: m.date,
      kind: "library",
      title: { complete: `${m.library} fully implemented`, half: `${m.library} is now half implemented`, started: `${m.library}: first functions implemented` }[m.kind],
      text: { complete: `All ${number.format(m.total)} of its declared functions are implemented.`, half: `${counts} implemented.`, started: `${counts} implemented so far.` }[m.kind],
      url: "/progress#libraries",
      milestone: m.kind,
    });
  }

  const firstMergeDay = merges.at(-1)?.mergedAt.slice(0, 10) ?? "9999";

  // Before the merge history starts, one digest per week from the progress series.
  const libraryWeeks = weekly(libraries);
  const shaderWeeks = weekly(coverage?.history ?? []);
  const weeks = [...new Set([...libraryWeeks.keys(), ...shaderWeeks.keys()])].sort();
  weeks.forEach((week, i) => {
    if (i === 0 || week >= weekOf(firstMergeDay)) return;
    const prior = weeks[i - 1];
    const lib = libraryWeeks.get(week);
    const libBefore = libraryWeeks.get(prior);
    const sh = shaderWeeks.get(week);
    const shBefore = shaderWeeks.get(prior);
    const parts: string[] = [];
    if (lib && libBefore && lib.libraries.done !== libBefore.libraries.done) parts.push(`${signed(lib.libraries.done - libBefore.libraries.done)} system library functions`);
    if (sh?.instructions && shBefore?.instructions && sh.instructions.decoded !== shBefore.instructions.decoded) {
      parts.push(`${signed(sh.instructions.decoded - shBefore.instructions.decoded)} instruction forms decoded`);
    }
    if (sh && shBefore && sh.throws !== shBefore.throws) parts.push(`unsupported cases ${number.format(shBefore.throws)} → ${number.format(sh.throws)}`);
    if (!parts.length) return;
    const date = [lib?.date, sh?.date].filter((d): d is string => Boolean(d)).sort().at(-1)!;
    updates.push({
      id: `week:${week}`,
      date,
      kind: "week",
      title: `Progress, week of ${new Date(`${week}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`,
      text: `${parts.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()),
      url: "/progress",
    });
  });

  return updates.sort((a, b) => b.date.localeCompare(a.date) || kindOrder(a) - kindOrder(b) || stageRank(b.stage) - stageRank(a.stage));
}

const kindOrder = (u: Update) => ["release", "digest", "week", "library", "stage", "merge"].indexOf(u.kind);
