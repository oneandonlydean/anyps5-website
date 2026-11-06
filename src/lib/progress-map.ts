import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { UPSTREAM_PAGES } from "./site";

/**
 * Upstream's library map (progress.svg: every system library function as a square, green when implemented) as a PNG,
 * drawn once per build. Served at /bot/progress.png for the bot's /progressmap, since Discord doesn't show SVG. Null when
 * upstream can't be reached, so the build leaves it out.
 */

const MAP_SOURCE = `${UPSTREAM_PAGES}/progress.svg`;
const MAP_WIDTH = 2000;

let map: Promise<{ png: Buffer; width: number; height: number } | null> | undefined;

export function progressMap() {
  map ??= (async () => {
    try {
      const res = await fetch(MAP_SOURCE);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const image = new Resvg(await res.text(), { fitTo: { mode: "width", value: MAP_WIDTH }, font: { loadSystemFonts: true } }).render();
      const png = await sharp(image.asPng()).png({ compressionLevel: 9, palette: true }).toBuffer();
      return { png, width: image.width, height: image.height };
    } catch (error) {
      console.warn(`progress map: left out, ${MAP_SOURCE} couldn't be rendered: ${(error as Error).message}`);
      return null;
    }
  })();
  return map;
}
