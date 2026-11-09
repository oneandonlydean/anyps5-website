import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { mediaId } from "./screenshots";

const SONY_CDN = /^https:\/\/image\.api\.playstation\.com\//;

/**
 * SteamGridDB serves art only as the full-size original, often a PNG near 1 MB that a page then shows 200 pixels
 * wide. `npm run sync:art-copies` keeps WebP copies of it in public/art/ (not committed), at these widths up to the
 * original's own, as /art/<id>-<width>.webp.
 */
export const COPIED = /^https:\/\/cdn2\.steamgriddb\.com\//;
export const COPY_WIDTHS = [240, 480, 800, 1280, 1920];
export const COPY_DIR = resolve(process.cwd(), "public/art");
export const copyFile = (url: string, width: number) => `${mediaId(url)}-${width}.webp`;

let copies: Map<string, number[]> | undefined;

/** The widths an image has copies at, smallest first; none when the sync has not copied it (pages then link the original). */
function copyWidths(url: string): number[] {
  if (!COPIED.test(url)) return [];
  if (!copies) {
    copies = new Map();
    let files: string[] = [];
    try {
      files = readdirSync(COPY_DIR);
    } catch {}
    for (const file of files) {
      const [, id, width] = file.match(/^(\w+)-(\d+)\.webp$/) ?? [];
      if (id) copies.set(id, [...(copies.get(id) ?? []), Number(width)].sort((a, b) => a - b));
    }
  }
  return copies.get(mediaId(url)) ?? [];
}

/** The smallest copy that covers a width, or the largest there is. */
const copyAt = (url: string, widths: number[], width: number) => widths.find((w) => w >= width) ?? widths.at(-1)!;

/** Art at its own host, resized where the host does that (the PlayStation CDN): for OG images and the bot, which fetch it. */
export function hostArt(url: string, width: number): string {
  return SONY_CDN.test(url) ? `${url}?w=${width}` : url;
}

/** Art for a page, about `width` pixels wide. */
export function artSrc(url: string, width: number): string {
  const widths = copyWidths(url);
  return widths.length ? `/art/${copyFile(url, copyAt(url, widths, width))}` : hostArt(url, width);
}

export function artSrcset(url: string, widths: number[]): string | undefined {
  if (SONY_CDN.test(url)) return widths.map((w) => `${url}?w=${w} ${w}w`).join(", ");
  const copied = copyWidths(url);
  if (!copied.length) return undefined;
  return [...new Set(widths.map((w) => copyAt(url, copied, w)))].map((w) => `/art/${copyFile(url, w)} ${w}w`).join(", ");
}
