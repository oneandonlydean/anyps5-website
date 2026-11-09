import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strings } from "../i18n";
import { buildLabel } from "./builds";
import { gameSeries } from "./compat-history";
import { getBuilds, getGames, getNeeds, getRetest, getScreenshots, getTested, getTrackedGames } from "./data";
import { loadBotText } from "./load";
import { openFunctions, tallyWanted } from "./needs";
import { newReportUrl } from "./site";
import { stageRank, type StageOrNone } from "./stages";
import { CATEGORY, getUpdates } from "./updates";
import { getCompatHistory, getCoverage, getLibraryHistory, getProgress, getRelease } from "./upstream";
import { hostArt } from "./art";

/**
 * Everything the Discord bot answers commands from, in one file it reads from the site's own assets: games, library and
 * shader coverage, what games wait on, the release, the tracked games, the FAQ and data/bot.yaml. Links are paths on
 * the site; the bot adds its domain.
 */

const BLOCKERS_SHOWN = 3;
const WANTED_SHOWN = 15;
const MILESTONES_SHOWN = 8;
const DAY = 864e5;
/** /recent looks back this far; single merges are left out, as the day's digest covers them. */
const RECENT_DAYS = 30;
const RECENT_SHOWN = 80;

/**
 * Who reports how far games get: Discussions reports and uploaded run reports per GitHub account, in total and over the
 * last 30 and 7 days, most first.
 */
function testers(games: Awaited<ReturnType<typeof getGames>>, now: number) {
  const people = new Map<string, { login: string; reports: number; uploads: number; games: Set<string>; month: number; week: number; last: string }>();
  const add = (login: string | null, date: string, slug: string, kind: "reports" | "uploads") => {
    if (!login) return;
    const p = people.get(login.toLowerCase()) ?? { login, reports: 0, uploads: 0, games: new Set<string>(), month: 0, week: 0, last: date };
    p[kind]++;
    p.games.add(slug);
    const age = now - Date.parse(date);
    if (age <= 30 * DAY) p.month++;
    if (age <= 7 * DAY) p.week++;
    if (date > p.last) p.last = date;
    people.set(login.toLowerCase(), p);
  };
  for (const g of games) {
    for (const r of g.reports) add(r.author, r.date, g.slug, "reports");
    for (const u of g.uploads) add(u.login, u.at, g.slug, "uploads");
  }
  const all = [...people.values()].map((p) => ({ login: p.login, reports: p.reports, uploads: p.uploads, games: p.games.size, month: p.month, week: p.week, last: p.last }));
  return {
    totals: {
      testers: all.length,
      reports: all.reduce((n, p) => n + p.reports, 0),
      uploads: all.reduce((n, p) => n + p.uploads, 0),
      month: all.reduce((n, p) => n + p.month, 0),
      week: all.reduce((n, p) => n + p.week, 0),
    },
    // Everyone, most reports first: the leaderboard ranks them by any period, and /profile finds anyone.
    people: all.sort((a, b) => b.reports + b.uploads - (a.reports + a.uploads) || b.last.localeCompare(a.last)),
  };
}

/** The FAQ's HTML answers as Discord markdown. */
const markdown = (html: string) =>
  html
    .replace(/<a href="([^"]+)">(.*?)<\/a>/g, "[$2]($1)")
    .replace(/<\/?(b|strong)>/g, "**")
    .replace(/<\/?code>/g, "`")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]!);

/** The furthest stage a game reached on each system ("linux/NVIDIA"), from every report and upload, for /games. */
function systems(game: Awaited<ReturnType<typeof getGames>>[number]): Record<string, StageOrNone> {
  const out: Record<string, StageOrNone> = {};
  const add = (os: string | null, vendor: string | null, stage: StageOrNone | null) => {
    if (!stage || !os || !vendor) return;
    const key = `${os.toLowerCase()}/${vendor.toUpperCase() === "NVIDIA" || vendor.toUpperCase() === "AMD" ? vendor.toUpperCase() : vendor}`;
    if (stageRank(stage) > stageRank(out[key] ?? null)) out[key] = stage;
  };
  for (const r of game.reports) add(r.platform, r.gpuVendor, r.stage);
  for (const u of game.uploads) add(u.os, u.gpuVendor, u.stage as StageOrNone | null);
  return out;
}

/** A heading's anchor, as Astro writes it (github-slugger's rule). */
const anchor = (heading: string) =>
  heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/** MDX prose as Discord markdown: components, HTML and images dropped, site links kept as paths. */
const plain = (mdx: string) =>
  mdx
    .replace(/<[A-Z][\s\S]*?\/>/g, "")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const SECTION_CHARS = 700;

/**
 * A guide section's opening, as Discord markdown: its first blocks up to about SECTION_CHARS, and the block after one
 * that ends in a colon. Tabs and callouts keep their content (the first tab is Linux's); a table becomes a list.
 */
function opening(section: string): string {
  const PLATFORM: Record<string, string> = { linux: "Linux", windows: "Windows", macos: "macOS" };
  const text = section
    .split("\n")
    // A platform tab keeps its name as a label; other component tags go.
    .map((line) => line.replace(/^\s*<Tab platform="(\w+)">\s*$/, (_, p: string) => `**${PLATFORM[p] ?? p}**`))
    .filter((line) => !/^\s*<\/?[A-Z][^>]*>\s*$/.test(line))
    .join("\n")
    // A table's rows as "- **first cell**: the rest", without its header and divider.
    .replace(/(?:^\|.*\|\s*$\n?)+/gm, (table) =>
      table
        .trim()
        .split("\n")
        .slice(2)
        .map((row) => row.split("|").slice(1, -1).map((c) => c.trim()))
        .map(([first, ...others]) => `- **${first}**: ${others.join(" · ")}`)
        .join("\n") + "\n",
    );
  const blocks = plain(text).split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];
  for (const block of blocks) {
    const wanted = out.length === 0 || out.at(-1)!.endsWith(":") || out.join("\n\n").length + block.length < SECTION_CHARS;
    if (!wanted) break;
    out.push(block);
  }
  return out.join("\n\n");
}

/**
 * The setup guide's steps (src/content/guide, English), for /setup: each step's summary, and each section's first
 * paragraph with a link to it. Long answers stay on the site.
 */
async function guide() {
  const dir = resolve(process.cwd(), "src/content/guide");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".mdx"));
  const steps = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(resolve(dir, file), "utf8");
      const front = raw.match(/^---\n([\s\S]*?)\n---\n/);
      const meta = Object.fromEntries((front?.[1] ?? "").split("\n").map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m![1], m![2]!.replace(/^["']|["']$/g, "")]));
      const body = raw.slice(front?.[0].length ?? 0);
      const sections = body
        .split(/^## /m)
        .slice(1)
        .map((part) => {
          const [heading, ...rest] = part.split("\n");
          return { heading: heading!.trim(), anchor: anchor(heading!), text: opening(rest.join("\n")) };
        });
      return { slug: file.replace(/\.mdx$/, ""), step: Number(meta.step), title: meta.title ?? file, summary: meta.summary ?? "", sections };
    }),
  );
  return steps.sort((a, b) => a.step - b.step);
}

/** Builds once per site build: the bot's data file and its pictures share it. */
let built: ReturnType<typeof build> | undefined;
export const botData = () => (built ??= build());

async function build() {
  const [games, builds, tested, retest, trackedGames, needs, progress, coverage, release, text, libraryHistory, compatHistory, updates, screenshots, steps] = await Promise.all([
    getGames(),
    getBuilds(),
    getTested(),
    getRetest(),
    getTrackedGames(),
    getNeeds(),
    getProgress(),
    getCoverage(),
    getRelease(),
    loadBotText(),
    getLibraryHistory(),
    getCompatHistory(),
    getUpdates(),
    getScreenshots(),
    guide(),
  ]);
  const now = Date.now();
  // Games per stage now, a week ago and a month ago (or the first day there is, while there are fewer).
  const series = gameSeries(games, compatHistory, new Date(now).toISOString().slice(0, 10)).days;
  const day = (back: number) => series.at(-1 - back) ?? series[0];
  const firstRelease = builds.releases.at(-1)?.tag;
  const latest = builds.releases[0]?.tag;
  const name = new Map(games.map((g) => [g.slug, g.name]));
  const asset = (pattern: RegExp) => {
    const found = release?.assets.find((a) => pattern.test(a.name));
    return found ? { name: found.name, url: found.url, size: found.size } : null;
  };

  const data = {
    generated: new Date().toISOString(),
    games: games.map((g) => {
      const last = retest.get(g.slug)!;
      return {
        slug: g.slug,
        name: g.name,
        ids: g.titleIds,
        stage: g.stage,
        cover: g.art?.cover ? hostArt(g.art.cover, 240) : null,
        tested: last.lastTested ? { date: last.lastTested, build: last.lastBuild ? buildLabel(last.lastBuild, firstRelease) : null, releasesSince: last.releasesSince } : null,
        blockers: g.blockers.slice(0, BLOCKERS_SHOWN).map((b) => ({ number: b.number, kind: b.kind, title: b.title, url: b.url })),
        thread: g.threads[0]?.url ?? newReportUrl(`${g.name} (${g.titleIds[0]})`),
        systems: systems(g),
      };
    }),
    libraries: progress && {
      done: progress.libraries.done,
      total: progress.libraries.total,
      groups: progress.libraries.groups.map((l) => ({ name: l.label, done: l.done, total: l.total })),
      milestones: (libraryHistory?.milestones ?? []).slice(0, MILESTONES_SHOWN),
    },
    shaders: coverage && {
      decoded: coverage.instructions.decoded,
      translated: coverage.instructions.translated,
      total: coverage.instructions.total,
      dpp: coverage.dpp,
      formats: coverage.formats,
      throws: { total: coverage.throws.total, areas: coverage.throws.areas.slice(0, 5) },
      untranslated: coverage.untranslated.slice(0, 20),
    },
    stages: { now: day(0)?.counts ?? {}, week: { date: day(7)?.date ?? null, counts: day(7)?.counts ?? {} }, month: { date: day(30)?.date ?? null, counts: day(30)?.counts ?? {} } },
    testers: testers(games, now),
    /** Games stuck on at least one missing function. */
    wantedGames: [...needs.values()].filter((n) => openFunctions(n).length > 0).length,
    wanted: tallyWanted(needs, openFunctions, (f) => f.name)
      .slice(0, WANTED_SHOWN)
      .map(({ item, games: slugs }) => ({ name: item.name, library: item.library, games: slugs.map((s) => name.get(s) ?? s) })),
    release: release && {
      tag: release.tag,
      name: release.name,
      url: release.url,
      published: release.published,
      downloads: { linux: asset(/^relinker-v[\d.]+$/), windows: asset(/^relinker-v[\d.]+\.exe$/), librariesLinux: asset(/^prx-linux-.*\.zip$/), librariesWindows: asset(/^prx-windows-.*\.zip$/) },
    },
    tracked: latest
      ? {
          release: latest,
          // Furthest first, so the bot can list them as they are.
          games: trackedGames
            .map((g) => {
              const on = tested.get(g.slug)?.releases.find((r) => r.release === latest);
              return { slug: g.slug, name: g.name, stage: on?.stage ?? null, ready: retest.get(g.slug)?.ready ?? false };
            })
            .sort((a, b) => stageRank(b.stage) - stageRank(a.stage) || a.name.localeCompare(b.name)),
        }
      : null,
    /** The Updates feed's last month, newest first, for /recent. */
    recent: updates
      .filter((u) => u.kind !== "merge" && now - Date.parse(u.date) <= RECENT_DAYS * DAY)
      .slice(0, RECENT_SHOWN)
      .map((u) => ({ kind: u.kind, category: CATEGORY[u.kind], date: u.date, title: u.title, url: u.url, game: u.game?.slug ?? null })),
    /** Community screenshots, for /screenshot: the site's WebP copy, who took it and where it was posted. */
    screenshots: [...screenshots].flatMap(([slug, list]) =>
      list.map((s) => ({ slug, image: `/community/${s.id}-full.webp`, author: s.author, url: s.url, date: s.date, stage: s.stage })),
    ),
    guide: steps,
    faq: strings("en").faq.groups.flatMap((group, gi) => group.questions.map(({ q, a }, qi) => ({ id: `q${gi + 1}-${qi + 1}`, q, a: markdown(a) }))),
    answers: text.answers,
    rules: text.rules.trim() || null,
  };
  return data;
}

export type BotData = Awaited<ReturnType<typeof build>>;
