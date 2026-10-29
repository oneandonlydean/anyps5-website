import type { NamedOverlay } from "./load";
import type { Art, Issue, Platform, Report, Thread, Title } from "./schema";
import { stageRank, type StageOrNone } from "./stages";

export interface Identity {
  key: string;
  slug: string;
  name: string;
  titleIds: string[];
  threads: Thread[];
  overlay: NamedOverlay | null;
}

export interface TimelineEvent {
  date: string;
  stage: StageOrNone;
  url: string | null;
}

export interface Game extends Omit<Identity, "overlay"> {
  aliases: string[];
  tags: string[];
  kind: "retail" | "homebrew" | "app";
  /** Every title ID with its store region code (EP, UP, JP...), when known. */
  releases: { titleId: string; region: string | null }[];
  stage: StageOrNone | null;
  branchStage: StageOrNone | null;
  verified: boolean;
  platforms: Partial<Record<Platform, StageOrNone>>;
  gpuVendors: string[];
  reporters: number;
  updated: string;
  note: string | null;
  blockers: Issue[];
  timeline: TimelineEvent[];
  reports: Report[];
  art: Art | null;
  overlayFile: string | null;
}

/** Build kinds whose reports set a game's headline stage. */
export const QUALIFYING = new Set(["main", "unknown"]);

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The name in a template-style title, `Game name (PPSA00000)`, or null when the title does not follow it. */
export function threadName(title: string): string | null {
  return title.match(/^\s*(.+?)\s*[([]\s*(?:PPSA|CUSA)\d{5}/i)?.[1].trim() ?? null;
}

function storeName(name: string): string {
  return name.replace(/[®™©]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Groups threads and overlays into one game each. Title IDs join when a thread or overlay lists them together, and
 * regional releases of one game join when they go by the same name: each title ID's curated name, else the name in
 * its thread title, else its store name (the store names some different apps alike, and a store concept can cover a
 * whole collection, so neither is trusted over what testers called it). Names only join within a console generation:
 * a PS4 and a PS5 game with one name can be different games.
 */
export function groupGames(threads: Thread[], overlays: NamedOverlay[], titles: Record<string, Title>): Identity[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const top = find(p);
    parent.set(id, top);
    return top;
  };
  const union = (ids: string[]) => ids.forEach((id) => parent.set(find(id), find(ids[0])));

  threads.forEach((t) => union(t.titleIds));
  overlays.forEach((o) => union(o.title_ids));

  const names = new Map<string, string>();
  const name = (value: string | null | undefined, ids: string[]) => ids.forEach((id) => value && !names.has(id) && names.set(id, value));
  overlays.forEach((o) => name(o.name, o.title_ids));
  threads.forEach((t) => name(threadName(t.title), t.titleIds));
  [...threads.flatMap((t) => t.titleIds), ...overlays.flatMap((o) => o.title_ids)].forEach((id) => name(titles[id] && storeName(titles[id].name), [id]));
  const firstNamed = new Map<string, string>();
  for (const [id, value] of names) {
    const key = `${id.slice(0, 4)}:${slugify(value)}`;
    if (key.endsWith(":")) continue;
    const first = firstNamed.get(key);
    if (first) union([first, id]);
    else firstNamed.set(key, id);
  }

  const groups = new Map<string, { ids: Set<string>; threads: Thread[]; overlay: NamedOverlay | null }>();
  const group = (id: string) => {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, { ids: new Set(), threads: [], overlay: null });
    return groups.get(root)!;
  };
  for (const thread of threads) {
    const g = group(thread.titleIds[0]);
    thread.titleIds.forEach((id) => g.ids.add(id));
    g.threads.push(thread);
  }
  for (const overlay of overlays) {
    const g = group(overlay.title_ids[0]);
    overlay.title_ids.forEach((id) => g.ids.add(id));
    g.overlay = overlay;
  }

  const used = new Set<string>();
  return [...groups.values()].map(({ ids, threads, overlay }) => {
    const titleIds = [...ids].sort();
    const key = titleIds.find((id) => titles[id]) ?? titleIds[0];
    const oldest = [...threads].sort((a, b) => a.number - b.number)[0];
    const name =
      overlay?.name ??
      (oldest && threadName(oldest.title)) ??
      (titles[key] && storeName(titles[key].name)) ??
      oldest?.title.trim() ??
      key;
    let slug = slugify(name) || key.toLowerCase();
    if (used.has(slug)) slug = `${slug}-${key.toLowerCase()}`;
    used.add(slug);
    return { key, slug, name, titleIds, threads, overlay };
  });
}

function best(reports: Report[]): Report | null {
  return reports.reduce<Report | null>((top, r) => {
    if (!top) return r;
    const diff = stageRank(r.stage) - stageRank(top.stage);
    return diff > 0 || (diff === 0 && r.date > top.date) ? r : top;
  }, null);
}

function timeline(reports: Report[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const r of [...reports].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!r.stage) continue;
    const last = events.at(-1);
    if (!last || stageRank(r.stage) > stageRank(last.stage)) events.push({ date: r.date, stage: r.stage, url: r.url });
  }
  return events;
}

function openBlockers(numbers: number[], issues: Record<number, Issue>): Issue[] {
  return numbers.map((n) => issues[n]).filter((i): i is Issue => i?.state === "open");
}

export function resolveGame(
  identity: Identity,
  titles: Record<string, Title>,
  issues: Record<number, Issue>,
  art: Record<string, Art>,
): Game {
  const { overlay, ...rest } = identity;
  const curated = overlay?.curated;
  const reports = identity.threads.flatMap((t) => t.reports).sort((a, b) => b.date.localeCompare(a.date));
  const qualifying = reports.filter((r) => QUALIFYING.has(r.buildKind));
  const top = best(qualifying);

  const reportWins = !curated || (top && top.date.slice(0, 10) > curated.date && stageRank(top.stage) > stageRank(curated.stage));
  const stage = reportWins ? (top?.stage ?? null) : curated.stage;
  const branchTop = best(reports.filter((r) => !QUALIFYING.has(r.buildKind)));
  const branchStage = branchTop && stageRank(branchTop.stage) > stageRank(stage) ? branchTop.stage : null;

  const platforms: Game["platforms"] = {};
  for (const r of qualifying) {
    if (r.platform && r.stage && stageRank(r.stage) > stageRank(platforms[r.platform])) platforms[r.platform] = r.stage;
  }
  Object.assign(platforms, curated?.platforms);

  const events = timeline(qualifying);
  // A curated stage is a rise only when it is above the last one reached; a correction downwards is not an event.
  if (curated && !reportWins && stageRank(curated.stage) > stageRank(events.at(-1)?.stage)) events.push({ date: curated.date, stage: curated.stage, url: null });

  const latestWithBlockers = reports.find((r) => r.blockers.length);
  const blockerNumbers = curated?.blockers ?? latestWithBlockers?.blockers ?? [];
  const updated = [...identity.threads.map((t) => t.updated), curated?.date ?? ""].sort().at(-1) ?? "";

  return {
    ...rest,
    aliases: overlay?.aliases ?? [],
    tags: overlay?.tags ?? [],
    kind: overlay?.kind ?? (titles[identity.key] ? "retail" : "homebrew"),
    releases: identity.titleIds.map((titleId) => ({ titleId, region: titles[titleId]?.region ?? null })),
    stage,
    branchStage,
    verified: Boolean(curated && !reportWins),
    platforms,
    gpuVendors: [...new Set(reports.map((r) => r.gpuVendor).filter((v): v is string => Boolean(v)))],
    reporters: new Set(reports.map((r) => r.author).filter(Boolean)).size,
    updated,
    note: (!reportWins && curated?.note) || reports.find((r) => r.shown)?.shown || null,
    blockers: openBlockers(blockerNumbers, issues),
    timeline: events.sort((a, b) => a.date.localeCompare(b.date)),
    reports,
    art: withOverrides(art[identity.key] ?? null, overlay?.art),
    overlayFile: overlay?.file ?? null,
  };
}

function withOverrides(art: Art | null, overrides: NamedOverlay["art"]): Art | null {
  if (!overrides) return art;
  const base: Art = art ?? { checked: "", square: null, cover: null, hero: null, logo: null, color: null, credits: [] };
  return { ...base, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) };
}
