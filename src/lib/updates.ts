import { getGames } from "./data";
import { loadGenerated } from "./load";
import { stageRank, type StageOrNone } from "./stages";
import { getCoverage, getProgressHistory } from "./upstream";

export type UpdateKind = "stage" | "release" | "week";

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

/** Stage rises, releases and weekly progress, newest first. Everything is derived from data the site already has. */
export function getUpdates(): Promise<Update[]> {
  return (cache ??= build());
}

async function build(): Promise<Update[]> {
  const [games, releases, libraries, coverage] = await Promise.all([getGames(), loadGenerated<ReleaseEntry[]>("releases.json", []), getProgressHistory(), getCoverage()]);
  const updates: Update[] = [];

  for (const g of games) {
    const game = { slug: g.slug, name: g.name, cover: g.art?.cover ?? g.art?.square ?? null, color: g.art?.color ?? null };
    g.timeline.forEach((event, i) => {
      const previous = g.timeline[i - 1];
      updates.push({
        id: `stage:${g.slug}:${event.stage}`,
        date: event.date,
        kind: "stage",
        title: previous ? `${g.name} reaches ${event.stage}` : `${g.name} tested: ${event.stage}`,
        text: previous ? `Up from ${previous.stage}.` : `First report for ${g.name}.`,
        url: `/compatibility/${g.slug}`,
        game,
        stage: event.stage,
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

  // One digest per week: what the libraries and the shader recompiler gained, compared with the week before.
  const libraryWeeks = weekly(libraries);
  const shaderWeeks = weekly(coverage?.history ?? []);
  const weeks = [...new Set([...libraryWeeks.keys(), ...shaderWeeks.keys()])].sort();
  weeks.forEach((week, i) => {
    if (i === 0) return;
    const before = weeks[i - 1];
    const lib = libraryWeeks.get(week);
    const libBefore = libraryWeeks.get(before);
    const sh = shaderWeeks.get(week);
    const shBefore = shaderWeeks.get(before);
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

const kindOrder = (u: Update) => ["release", "week", "stage"].indexOf(u.kind);
