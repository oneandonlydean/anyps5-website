import { stageSlug, type StageOrNone } from "../../../src/lib/stages";
import { baseUrl, type Env } from "./env";

/**
 * The site's data for the bot's commands, from /bot/data.json in its own assets (src/pages/bot/data.json.ts). Links
 * in it are paths on the site; `link` adds the domain.
 */

export interface SiteGame {
  slug: string;
  name: string;
  ids: string[];
  stage: StageOrNone | null;
  cover: string | null;
  tested: { date: string; build: string | null; releasesSince: number } | null;
  blockers: { number: number; kind: "issue" | "pr"; title: string; url: string }[];
  thread: string;
}

export interface Download {
  name: string;
  url: string;
  size: number;
}

export interface SiteData {
  generated: string;
  games: SiteGame[];
  libraries: { done: number; total: number; groups: { name: string; done: number; total: number }[] } | null;
  shaders: { decoded: number; translated: number; total: number } | null;
  wanted: { name: string; library: string; games: string[] }[];
  release: {
    tag: string;
    name: string;
    url: string;
    published: string;
    downloads: Record<"linux" | "windows" | "librariesLinux" | "librariesWindows", Download | null>;
  } | null;
  tracked: { release: string; games: { slug: string; name: string; stage: StageOrNone | null; ready: boolean }[] } | null;
  faq: { id: string; q: string; a: string }[];
  answers: { topic: string; title: string; text: string }[];
  rules: string | null;
}

/** Kept for a few minutes per Worker instance: the file only changes when the site rebuilds. */
const FRESH_MS = 5 * 60_000;
let cached: { at: number; data: SiteData } | undefined;

export async function siteData(env: Env): Promise<SiteData | null> {
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.data;
  if (!env.ASSETS) return null;
  try {
    const res = await env.ASSETS.fetch(`${baseUrl(env)}/bot/data.json`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    cached = { at: Date.now(), data: await res.json<SiteData>() };
    return cached.data;
  } catch {
    // An older copy is better than none while the site is between deploys.
    return cached?.data ?? null;
  }
}

/** For tests: forget the cached file. */
export const forgetSiteData = () => {
  cached = undefined;
};

/** A site path (or a full URL) as a full URL; markdown links written as paths too. */
export const link = (env: Env, path: string) => (path.startsWith("/") ? `${baseUrl(env)}${path}` : path);
export const links = (env: Env, markdown: string) => markdown.replace(/\]\(\//g, `](${baseUrl(env)}/`);

/** The site's stage colours, for embeds. */
const STAGE_COLOR: Record<string, number> = {
  none: 0x6b7385,
  converts: 0xf0506e,
  loads: 0xf77b3e,
  starts: 0xf6a23a,
  "first-draw": 0xf2cc3d,
  presents: 0xb5e04a,
  menus: 0x5bd977,
  ingame: 0x2fcfa6,
  playable: 0x3cc8f0,
  untested: 0x2a3142,
};
export const stageColor = (stage: StageOrNone | null) => STAGE_COLOR[stageSlug(stage)]!;

/** A text meter for embeds: ▰▰▰▱▱▱ 42%. */
export function meter(done: number, total: number, width = 12): string {
  const share = total ? done / total : 0;
  const filled = Math.round(share * width);
  // One decimal near either end, so 99.7% doesn't read as complete or 0.4% as nothing.
  const near = (share > 0 && share < 0.1) || (share > 0.99 && share < 1);
  return `${"▰".repeat(filled)}${"▱".repeat(width - filled)} ${(Math.floor(share * (near ? 1000 : 100)) / (near ? 10 : 1)).toFixed(near ? 1 : 0)}%`;
}

/** Plain words for matching what people type against names: lower case, no punctuation. */
export const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Games whose name, title ID or slug match, best first: exact, then starting with, then containing. */
export function findGames(data: SiteData, query: string): SiteGame[] {
  const q = words(query);
  if (!q) return data.games;
  const score = (g: SiteGame) => {
    const name = words(g.name);
    if (g.slug === query || g.ids.some((id) => id.toLowerCase() === q.replace(/ /g, "")) || name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q) || g.ids.some((id) => id.toLowerCase().includes(q.replace(/ /g, "")))) return 2;
    return 3;
  };
  return data.games
    .map((g) => ({ g, s: score(g) }))
    .filter((x) => x.s < 3)
    .sort((a, b) => a.s - b.s || a.g.name.localeCompare(b.g.name))
    .map((x) => x.g);
}
