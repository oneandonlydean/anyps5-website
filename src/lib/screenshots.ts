import type { Platform, Report, Shot, Thread } from "./schema";
import { stageRank, type StageOrNone } from "./stages";

/** The WebP copies the sync writes for each community image, served from /community/<id>-<name>.webp. */
export const SHOT_SIZES = [
  { name: "thumb", width: 720, quality: 72 },
  { name: "full", width: 1920, quality: 82 },
] as const;

/** A stable short file name for an image URL (cyrb53, so it needs no crypto module). */
export function mediaId(src: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface Screenshot {
  id: string;
  /** Where the image was posted, and the original file. */
  url: string;
  src: string;
  alt: string;
  author: string | null;
  date: string;
  width: number;
  height: number;
  color: string;
  /** From the test report the image was posted with, when it was posted with one. */
  stage: StageOrNone | null;
  platform: Platform | null;
  gpuVendor: string | null;
}

/** File-name alt text ("image", "Screenshot 2026-10-19 195751") says nothing; real captions are kept. */
export function caption(alt: string): string | null {
  const text = alt.trim();
  if (!text || /^(image|img|screenshot|captura|снимок|изображение|untitled)[\s_\-\d.:()a-z]*$/i.test(text) || /\.(png|jpe?g|webp|gif)$/i.test(text)) return null;
  if (/^(screenshot|captura de pantalla|bildschirmfoto|snapshot)[\s_\-]*\d/i.test(text)) return null;
  return text;
}

/**
 * A game's community screenshots: images from its discussion threads that the sync downloaded. Images posted with a
 * report carry its stage; the furthest stage comes first, then the newest.
 */
export function gameScreenshots(threads: Thread[], shots: Record<string, Shot>): Screenshot[] {
  const reports = new Map<string, Report>(threads.flatMap((t) => t.reports.map((r) => [r.url, r] as const)));
  const seen = new Set<string>();
  const out: Screenshot[] = [];
  for (const media of threads.flatMap((t) => t.media)) {
    const id = mediaId(media.src);
    const shot = shots[id];
    if (!shot || "skipped" in shot || seen.has(id)) continue;
    seen.add(id);
    const report = reports.get(media.url);
    out.push({
      id,
      url: media.url,
      src: media.src,
      alt: media.alt,
      author: media.author,
      date: media.date,
      width: shot.width,
      height: shot.height,
      color: shot.color,
      stage: report?.stage ?? null,
      platform: report?.platform ?? null,
      gpuVendor: report?.gpuVendor ?? null,
    });
  }
  const rank = (s: Screenshot) => (s.stage ? stageRank(s.stage) : -2);
  return out.sort((a, b) => rank(b) - rank(a) || b.date.localeCompare(a.date));
}
