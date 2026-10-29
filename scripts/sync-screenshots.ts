import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { generated, readJson, root, writeJson } from "./lib/files";
import { mediaId, SHOT_SIZES } from "../src/lib/screenshots";
import type { Shot, Thread } from "../src/lib/schema";

/**
 * Downloads every image posted in the bring-up discussions once and writes WebP copies the site serves itself: the
 * originals are often multi-megabyte PNGs, some behind redirects that expire. The size, dominant colour, or reason an
 * image is left out goes to screenshots.json; the images go to public/community/ (not committed).
 */

const OUT = generated("screenshots.json");
const DIR = resolve(root, "public/community");
const RETRY_DAYS = 7;
const MAX_BYTES = 30 * 1024 * 1024;
// Icons, emoji and inline diagrams rather than screenshots; panoramas and strips that would not tile.
const MIN_WIDTH = 480;
const MIN_HEIGHT = 270;
const MAX_RATIO = 3.2;

const files = (id: string) => SHOT_SIZES.map((size) => resolve(DIR, `${id}-${size.name}.webp`));

async function download(src: string): Promise<Buffer> {
  const response = await fetch(src, { redirect: "follow", signal: AbortSignal.timeout(45_000), headers: { "User-Agent": "anyps5-website" } });
  if (!response.ok) throw new Error(`${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("too large");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error("too large");
  return body;
}

/** Mean luminance of an image file, from 0 to 1. */
async function brightness(path: string): Promise<number> {
  const { channels } = await sharp(path).greyscale().stats();
  return Math.round((channels[0].mean / 255) * 1000) / 1000;
}

async function convert(id: string, src: string): Promise<Shot> {
  const checked = new Date().toISOString();
  let input: Buffer;
  try {
    input = await download(src);
  } catch {
    return { src, skipped: "failed", checked };
  }
  try {
    // The first frame of an animation; orientation from EXIF; a pixel limit against decompression bombs.
    const image = sharp(input, { limitInputPixels: 80_000_000 }).rotate();
    const { width = 0, height = 0 } = await image.metadata();
    if (width < MIN_WIDTH || height < MIN_HEIGHT) return { src, skipped: "small", checked };
    if (Math.max(width / height, height / width) > MAX_RATIO) return { src, skipped: "shape", checked };
    const { dominant } = await image.clone().stats();
    for (const [size, path] of SHOT_SIZES.map((s, i) => [s, files(id)[i]] as const)) {
      await image.clone().resize({ width: Math.min(size.width, width), withoutEnlargement: true }).webp({ quality: size.quality }).toFile(path);
    }
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return { src, width, height, color: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`, brightness: await brightness(files(id)[0]) };
  } catch {
    return { src, skipped: "failed", checked };
  }
}

async function main() {
  const threads = await readJson<Thread[]>(generated("threads.json"), []);
  const previous = await readJson<Record<string, Shot>>(OUT, {});
  await mkdir(DIR, { recursive: true });

  const sources = [...new Set(threads.flatMap((t) => t.media.map((m) => m.src)))];
  const stale = (shot: Shot | undefined, id: string) =>
    !shot || ("skipped" in shot ? shot.skipped === "failed" && Date.now() - Date.parse(shot.checked) > RETRY_DAYS * 864e5 : !files(id).every(existsSync));
  const todo = sources.filter((src) => stale(previous[mediaId(src)], mediaId(src)));

  const out: Record<string, Shot> = {};
  for (const src of sources) if (previous[mediaId(src)]) out[mediaId(src)] = previous[mediaId(src)];
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < todo.length) {
        const src = todo[next++];
        out[mediaId(src)] = await convert(mediaId(src), src);
      }
    }),
  );

  // Entries from before brightness was recorded are measured from their thumbnails.
  for (const [id, shot] of Object.entries(out)) {
    if (!("skipped" in shot) && shot.brightness === undefined && existsSync(files(id)[0])) out[id] = { ...shot, brightness: await brightness(files(id)[0]) };
  }

  await writeJson(OUT, Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))));
  const shown = Object.values(out).filter((s) => !("skipped" in s)).length;
  console.log(`screenshots: ${shown} shown of ${sources.length} (${todo.length} processed)`);
}

await main();
