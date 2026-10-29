import sharp from "sharp";
import { generated, readJson, writeJson } from "./lib/files";
import { vibrantColor } from "../src/lib/color";
import { loadGenerated, loadOverlays } from "../src/lib/load";
import { groupGames, type Identity } from "../src/lib/resolve";
import type { Art, Thread, Title } from "../src/lib/schema";

const OUT = generated("art.json");
const DAY = 86_400_000;
const FRESH_FOUND = 30 * DAY;
const FRESH_MISS = 7 * DAY;
const CONCURRENCY = 4;
const UA = "Mozilla/5.0 (compatible; anyps5-website; +https://github.com/boykopovar/AnyPS5)";
const SONY_CDN = /^https:\/\/image\.api\.playstation\.com\//;
const SGDB = "https://www.steamgriddb.com/api/v2";
// A local .env (not committed) can hold the key; CI passes it as an environment variable instead.
try {
  process.loadEnvFile();
} catch {}
const SGDB_KEY = process.env.SGDB_API_KEY;

type Roles = Pick<Art, "square" | "cover" | "hero" | "logo">;
const STORE_ROLES: Record<keyof Roles, string[]> = {
  square: ["MASTER"],
  cover: ["PORTRAIT_BANNER"],
  hero: ["GAMEHUB_COVER_ART", "BACKGROUND"],
  logo: ["LOGO"],
};

interface Media {
  role?: string;
  type?: string;
  url?: string;
}

/** The concept's own media, then its default product's; editions and add-ons on the same page are ignored. */
export function conceptMedia(html: string, concept: string): Partial<Roles> {
  const objects = new Map<string, Record<string, unknown>[]>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object" && (key === `Concept:${concept}` || key.startsWith("Product:"))) {
        objects.set(key, [...(objects.get(key) ?? []), value as Record<string, unknown>]);
      }
      collect(value);
    }
  };
  for (const [, blob] of html.matchAll(/<script[^>]*type="application\/json"[^>]*>(.*?)<\/script>/gs)) {
    try {
      collect(JSON.parse(blob));
    } catch {}
  }

  const media: Media[] = [];
  let product: string | undefined;
  for (const c of objects.get(`Concept:${concept}`) ?? []) {
    media.push(...((c.personalizedMeta as { media?: Media[] })?.media ?? []), ...((c.media as Media[]) ?? []));
    product ??= (c.defaultProduct as { __ref?: string })?.__ref;
  }
  for (const p of (product && objects.get(product)) || []) media.push(...((p.media as Media[]) ?? []));

  const found: Partial<Roles> = {};
  for (const [use, roles] of Object.entries(STORE_ROLES) as [keyof Roles, string[]][]) {
    for (const role of roles) {
      const hit = media.find((m) => m.role === role && m.type === "IMAGE" && SONY_CDN.test(m.url ?? ""));
      if (hit) {
        found[use] = hit.url!;
        break;
      }
    }
  }
  return found;
}

// A 404 means a source has no art for the game; any other failure throws, so the game keeps its cached art.
async function storeArt(concept: string): Promise<Partial<Roles>> {
  const response = await fetch(`https://store.playstation.com/en-us/concept/${concept}`, { headers: { "User-Agent": UA } });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`PlayStation Store ${response.status}`);
  return conceptMedia(await response.text(), concept);
}

async function sgdb<T>(path: string): Promise<T[]> {
  const response = await fetch(`${SGDB}${path}`, { headers: { Authorization: `Bearer ${SGDB_KEY}` } });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`SteamGridDB ${response.status}`);
  return ((await response.json()) as { data?: T[] }).data ?? [];
}

async function steamGridArt(name: string): Promise<Partial<Roles>> {
  if (!SGDB_KEY) return {};
  const [game] = await sgdb<{ id: number }>(`/search/autocomplete/${encodeURIComponent(name)}`);
  if (!game) return {};
  const first = async (path: string) => (await sgdb<{ url: string }>(path))[0]?.url;
  const [cover, hero, logo, square] = await Promise.all([
    first(`/grids/game/${game.id}?dimensions=600x900&types=static`),
    first(`/heroes/game/${game.id}?types=static`),
    first(`/logos/game/${game.id}?types=static`),
    first(`/grids/game/${game.id}?dimensions=1024x1024,512x512&types=static`),
  ]);
  return Object.fromEntries(Object.entries({ cover, hero, logo, square }).filter(([, v]) => v));
}

async function artColor(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(SONY_CDN.test(url) ? `${url}?w=64` : url, { headers: { "User-Agent": UA } });
    if (!response.ok) return null;
    const image = sharp(Buffer.from(await response.arrayBuffer())).removeAlpha();
    const { data, info } = await image.clone().resize(48, 48, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
    const vibrant = vibrantColor(data, info.channels);
    if (vibrant) return vibrant;
    const { dominant } = await image.stats();
    return "#" + [dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function resolve(identity: Identity, titles: Record<string, Title>): Promise<Art> {
  const concept = identity.titleIds.map((id) => titles[id]?.concept).find(Boolean);
  const store = concept ? await storeArt(concept) : {};
  const missing = (Object.keys(STORE_ROLES) as (keyof Roles)[]).some((role) => !store[role]);
  const grid = missing ? await steamGridArt(identity.name) : {};

  const roles: Roles = {
    square: store.square ?? grid.square ?? null,
    cover: store.cover ?? grid.cover ?? null,
    hero: store.hero ?? grid.hero ?? null,
    logo: store.logo ?? grid.logo ?? null,
  };
  const credits: Art["credits"] = [];
  if (Object.keys(store).length) credits.push("PlayStation Store");
  if (Object.entries(grid).some(([role]) => !store[role as keyof Roles])) credits.push("SteamGridDB");

  return {
    checked: new Date().toISOString(),
    ...roles,
    color: await artColor(roles.square ?? roles.cover ?? roles.hero),
    credits,
  };
}

function isFresh(art: Art | undefined, now: number): boolean {
  if (!art) return false;
  const found = art.square || art.cover || art.hero;
  return now - Date.parse(art.checked) < (found ? FRESH_FOUND : FRESH_MISS);
}

async function main() {
  const force = process.argv.includes("--force");
  const titles = await loadGenerated<Record<string, Title>>("titles.json", {});
  const identities = groupGames(await loadGenerated<Thread[]>("threads.json", []), await loadOverlays(), titles);
  const cache = await readJson<Record<string, Art>>(OUT, {});
  const now = Date.now();
  const queue = identities.filter((i) => force || !isFresh(cache[i.key], now));
  const failed: string[] = [];

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let identity = queue.shift(); identity; identity = queue.shift()) {
        try {
          cache[identity.key] = await resolve(identity, titles);
        } catch (error) {
          failed.push(`${identity.name}: ${(error as Error).message}`);
        }
      }
    }),
  );

  const keys = new Set(identities.map((i) => i.key));
  const art = Object.fromEntries(Object.entries(cache).filter(([key]) => keys.has(key)).sort());
  await writeJson(OUT, art);
  const withArt = Object.values(art).filter((a) => a.square || a.cover).length;
  console.log(`art: ${withArt} of ${keys.size} games have cover art${SGDB_KEY ? "" : " (SGDB_API_KEY not set: PlayStation Store only)"}`);
  if (failed.length) console.warn(`art: kept cached art for ${failed.length} games after errors, e.g. ${failed.slice(0, 3).join("; ")}`);
}

await main();
