import type { NamedOverlay } from "./load";
import { TITLE_ID, type Art, type Issue, type Platform, type Report, type Thread, type Title } from "./schema";
import { stageRank, type StageOrNone } from "./stages";
import { autoStage, CONFIRMATIONS_NEEDED, type AutoStage, type UploadSummary } from "./uploads";

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
  /** Where the stage came from: a Discussions report (with a url), a maintainer, or confirmed uploads. */
  source?: "report" | "maintainer" | "uploads";
}

export interface Game extends Omit<Identity, "overlay"> {
  aliases: string[];
  tags: string[];
  kind: "retail" | "homebrew" | "app";
  /** Every title ID with its store region code (EP, UP, JP...), when known. */
  releases: { titleId: string; region: string | null }[];
  stage: StageOrNone | null;
  branchStage: StageOrNone | null;
  /** The report behind branchStage, and the pull requests its build used: open first, then merged since, then closed. */
  branch: { url: string; patched: boolean; prs: Issue[] } | null;
  verified: boolean;
  platforms: Partial<Record<Platform, StageOrNone>>;
  gpuVendors: string[];
  reporters: number;
  updated: string;
  note: string | null;
  /** The report the note was taken from; null for a maintainer's note. */
  noteFrom: { url: string; author: string | null } | null;
  /** A maintainer's stage, and the day they set it: reports from then or before that claimed more were overruled. */
  correction: { stage: StageOrNone; date: string } | null;
  blockers: Issue[];
  timeline: TimelineEvent[];
  reports: Report[];
  art: Art | null;
  overlayFile: string | null;
  /** Run reports uploaded on the site, newest first. */
  uploads: UploadSummary[];
  /** The furthest stage uploads reached, and whether it has enough confirmations to count. */
  autoStage: AutoStage | null;
}

/** What the site's own users added: uploaded run reports, and art maintainers hid ("<game key>:<role>"). */
export interface Community {
  uploads: UploadSummary[];
  hiddenArt: Set<string>;
}

/** Build kinds whose reports set a game's headline stage. */
export const QUALIFYING = new Set(["main", "unknown"]);

/** A result from before a maintainer's correction that claimed more than it counts at the corrected stage. */
export function corrected(stage: StageOrNone, date: string, correction: { stage: StageOrNone; date: string } | null | undefined): StageOrNone {
  return correction && date.slice(0, 10) <= correction.date && stageRank(stage) > stageRank(correction.stage) ? correction.stage : stage;
}

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
  // Some threads repeat the category in their title: "Game bring-up: Dusklight (PPSA12345)".
  const bare = title.replace(/^\s*(?:game\s*)?bring[\s-]*up\s*[:\-–—]\s*/i, "");
  return bare.match(/^\s*(.+?)\s*[([]\s*(?:PPSA|CUSA)\d{5}/i)?.[1].trim() ?? null;
}

function storeName(name: string): string {
  return name.replace(/[®™©]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Drops the bring-up threads a maintainer closed, so a closed game leaves the site. One comes back when it is reopened,
 * when someone posts a report in it after it was closed, or when a run of one of its title IDs is uploaded after that.
 */
export function visibleThreads(threads: Thread[], uploads: { titleId: string; at: string }[] = []): Thread[] {
  return threads.filter((t) => {
    const closed = t.closedAt;
    if (!closed) return true;
    const ids = new Set(t.titleIds);
    return t.reports.some((r) => r.date > closed) || uploads.some((u) => ids.has(u.titleId) && u.at > closed);
  });
}

/**
 * Groups threads and overlays into one game each. Title IDs join when a thread or overlay lists them together, and
 * regional releases of one game join when they go by the same name: each title ID's curated name, else the name in
 * its thread title, else its store name (the store names some different apps alike, and a store concept can cover a
 * whole collection, so neither is trusted over what testers called it). Names only join within a console generation:
 * a PS4 and a PS5 game with one name can be different games.
 *
 * Title IDs from uploaded run reports become games too, so a game can be added by uploading a run without a
 * Discussions thread. One the PlayStation Store doesn't list (homebrew) is named as its run report names it.
 */
export function groupGames(threads: Thread[], overlays: NamedOverlay[], titles: Record<string, Title>, uploads: { titleId: string; name?: string | null }[] = []): Identity[] {
  const uploaded = [...new Set(uploads.filter((u) => TITLE_ID.test(u.titleId) && (titles[u.titleId] || u.name)).map((u) => u.titleId))];
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
  [...threads.flatMap((t) => t.titleIds), ...overlays.flatMap((o) => o.title_ids), ...uploaded].forEach((id) => name(titles[id] && storeName(titles[id].name), [id]));
  uploads.forEach((u) => uploaded.includes(u.titleId) && name(u.name, [u.titleId]));
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
  for (const id of uploaded) group(id).ids.add(id);

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
      names.get(key) ??
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

const PR_ORDER = { open: 0, merged: 1, closed: 2 } as const;

function branchPrs(numbers: number[], issues: Record<number, Issue>): Issue[] {
  return numbers
    .map((n) => issues[n])
    .filter((i): i is Issue => i?.kind === "pr")
    .sort((a, b) => PR_ORDER[a.state] - PR_ORDER[b.state]);
}

function openBlockers(numbers: number[], issues: Record<number, Issue>): Issue[] {
  return numbers.map((n) => issues[n]).filter((i): i is Issue => i?.state === "open");
}

export function resolveGame(
  identity: Identity,
  titles: Record<string, Title>,
  issues: Record<number, Issue>,
  art: Record<string, Art>,
  community: Community = { uploads: [], hiddenArt: new Set() },
): Game {
  const { overlay, ...rest } = identity;
  const curated = overlay?.curated;
  const reports = identity.threads.flatMap((t) => t.reports).sort((a, b) => b.date.localeCompare(a.date));
  const qualifying = reports.filter((r) => QUALIFYING.has(r.buildKind));
  const top = best(qualifying);

  const reportWins = !curated || (top && top.date.slice(0, 10) > curated.date && stageRank(top.stage) > stageRank(curated.stage));
  const reported = reportWins ? (top?.stage ?? null) : curated.stage;
  // Uploads raise the stage once confirmed: two accounts, or one account and a Discussions report.
  const uploads = community.uploads.filter((u) => identity.titleIds.includes(u.titleId)).sort((a, b) => b.at.localeCompare(a.at));
  // A Discussions report confirms an upload only when it still stands (a maintainer's correction didn't overrule it)
  // and someone other than the uploaders wrote it.
  const auto = autoStage(uploads, reportWins && top ? { stage: top.stage, author: top.author } : null);
  const uploadWins = auto.confirmedStage !== null && stageRank(auto.confirmedStage) > stageRank(reported);
  const stage = uploadWins ? auto.confirmedStage : reported;
  const shownBy = reports.find((r) => r.shown);
  const branchTop = best(reports.filter((r) => !QUALIFYING.has(r.buildKind)));
  const branchStage = branchTop && stageRank(branchTop.stage) > stageRank(stage) ? branchTop.stage : null;

  const platforms: Game["platforms"] = {};
  for (const r of qualifying) {
    if (r.platform && r.stage && stageRank(r.stage) > stageRank(platforms[r.platform])) platforms[r.platform] = r.stage;
  }
  Object.assign(platforms, curated?.platforms);

  const events = timeline(qualifying);
  // Confirmed uploads add a rise only above the furthest stage already reached, dated no earlier than that rise.
  const furthestEvent = events.reduce<TimelineEvent | null>((a, e) => (!a || stageRank(e.stage) > stageRank(a.stage) ? e : a), null);
  if (uploadWins && stageRank(auto.confirmedStage) > stageRank(furthestEvent?.stage)) {
    const date = [confirmedAt(uploads, auto.confirmedStage!, top), events.at(-1)?.date ?? ""].sort().at(-1)!;
    events.push({ date, stage: auto.confirmedStage!, url: null, source: "uploads" });
  }
  // A curated stage is a rise only when it is above the last one reached; a correction downwards is not an event.
  if (curated && !reportWins && stageRank(curated.stage) > stageRank(events.at(-1)?.stage)) events.push({ date: curated.date, stage: curated.stage, url: null, source: "maintainer" });

  const latestWithBlockers = reports.find((r) => r.blockers.length);
  const blockerNumbers = curated?.blockers ?? latestWithBlockers?.blockers ?? [];
  const updated = [...identity.threads.map((t) => t.updated), curated?.date ?? "", uploads[0]?.at ?? ""].sort().at(-1) ?? "";

  return {
    ...rest,
    aliases: overlay?.aliases ?? [],
    tags: overlay?.tags ?? [],
    kind: overlay?.kind ?? (titles[identity.key] ? "retail" : "homebrew"),
    releases: identity.titleIds.map((titleId) => ({ titleId, region: titles[titleId]?.region ?? null })),
    stage,
    branchStage,
    branch: branchStage && branchTop ? { url: branchTop.url, patched: branchTop.buildKind === "patched", prs: branchPrs(branchTop.prs, issues) } : null,
    verified: Boolean(curated && !reportWins && !uploadWins),
    platforms,
    gpuVendors: [...new Set(reports.map((r) => r.gpuVendor).filter((v): v is string => Boolean(v)))],
    reporters: new Set([...reports.map((r) => r.author), ...uploads.map((u) => u.login)].filter(Boolean)).size,
    updated,
    correction: curated ? { stage: curated.stage, date: curated.date } : null,
    note: (!reportWins && curated?.note) || shownBy?.shown || null,
    noteFrom: (!reportWins && curated?.note) || !shownBy ? null : { url: shownBy.url, author: shownBy.author },
    blockers: openBlockers(blockerNumbers, issues),
    timeline: events.sort((a, b) => a.date.localeCompare(b.date)),
    reports,
    art: withoutHidden(withOverrides(art[identity.key] ?? null, overlay?.art), identity.key, community.hiddenArt),
    overlayFile: overlay?.file ?? null,
    uploads,
    autoStage: auto.furthest,
  };
}

/**
 * When uploads confirmed a stage: the upload that brought the count to two (or the first, with a Discussions report),
 * or the first one a maintainer verified.
 */
function confirmedAt(uploads: UploadSummary[], stage: StageOrNone, top: Report | null): string {
  const reaching = uploads.filter((u) => u.stage !== null && stageRank(u.stage) >= stageRank(stage)).sort((a, b) => a.at.localeCompare(b.at));
  const accounts = new Set<number>();
  const needed = stageRank(top?.stage) >= stageRank(stage) ? CONFIRMATIONS_NEEDED - 1 : CONFIRMATIONS_NEEDED;
  for (const u of reaching) {
    accounts.add(u.githubId);
    if (accounts.size >= needed || u.verifiedBy) return u.at;
  }
  return reaching.at(-1)!.at;
}

/** Art roles maintainers hid for this game are dropped, so the page falls back as if the art were missing. */
function withoutHidden(art: Art | null, key: string, hidden: Set<string>): Art | null {
  if (!art || !hidden.size) return art;
  const roles = ["square", "cover", "hero", "logo"] as const;
  return { ...art, ...Object.fromEntries(roles.filter((r) => hidden.has(`${key}:${r}`)).map((r) => [r, null])) };
}

function withOverrides(art: Art | null, overrides: NamedOverlay["art"]): Art | null {
  if (!overrides) return art;
  const base: Art = art ?? { checked: "", square: null, cover: null, hero: null, logo: null, color: null, credits: [] };
  return { ...base, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) };
}
