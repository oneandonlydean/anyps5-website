import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { generated, readJson } from "./lib/files";
import { COPIED, COPY_DIR, COPY_WIDTHS, copyFile } from "../src/lib/art";
import type { Art } from "../src/lib/schema";

/**
 * Keeps resized WebP copies of the art that comes from SteamGridDB, which serves only the full-size original. Each
 * image is downloaded once; pages use its copies when they exist and link the original otherwise (see src/lib/art.ts).
 */

const MAX_BYTES = 30 * 1024 * 1024;

/** Done when the smallest copy exists: it is written last. */
const done = (url: string) => existsSync(resolve(COPY_DIR, copyFile(url, COPY_WIDTHS[0])));

async function copy(url: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { "User-Agent": "anyps5-website" } });
  if (!response.ok) throw new Error(`${response.status}`);
  const input = Buffer.from(await response.arrayBuffer());
  if (input.length > MAX_BYTES) throw new Error("too large");
  const image = sharp(input, { limitInputPixels: 80_000_000 });
  const { width = 0 } = await image.metadata();
  // No copy is wider than the original, and the smallest is always written, even of a narrower original.
  const widths = COPY_WIDTHS.filter((w, i) => i === 0 || w <= width);
  for (const w of widths.reverse()) {
    await image.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toFile(resolve(COPY_DIR, copyFile(url, w)));
  }
}

async function main() {
  const art = await readJson<Record<string, Art>>(generated("art.json"), {});
  const urls = [...new Set(Object.values(art).flatMap((a) => [a.square, a.cover, a.hero, a.logo]))].filter((url): url is string => !!url && COPIED.test(url));
  const todo = urls.filter((url) => !done(url));
  await mkdir(COPY_DIR, { recursive: true });

  const failed: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < todo.length) {
        const url = todo[next++];
        await copy(url).catch((error) => failed.push(`${url}: ${(error as Error).message}`));
      }
    }),
  );
  console.log(`art copies: ${urls.length - failed.length} of ${urls.length} SteamGridDB images (${todo.length - failed.length} new)`);
  if (failed.length) console.warn(`art copies: ${failed.length} failed and stay linked to the original, e.g. ${failed.slice(0, 3).join("; ")}`);
}

await main();
