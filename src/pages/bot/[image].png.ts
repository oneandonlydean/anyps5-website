import { Resvg } from "@resvg/resvg-js";
import type { APIContext } from "astro";
import sharp from "sharp";
import { UPSTREAM_PAGES } from "../../lib/site";

/**
 * Upstream's library map (progress.svg: every system library function as a square, coloured by status) as a PNG for
 * the Discord bot's /progressmap, since Discord doesn't show SVG images. Rendered at build time; when upstream can't be
 * reached, the build leaves the image out and the command says so.
 */

const SOURCE = `${UPSTREAM_PAGES}/progress.svg`;
const WIDTH = 2000;

export async function getStaticPaths() {
  try {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const png = new Resvg(await res.text(), { fitTo: { mode: "width", value: WIDTH }, font: { loadSystemFonts: true } }).render().asPng();
    return [{ params: { image: "progress" }, props: { png: await sharp(png).png({ compressionLevel: 9, palette: true }).toBuffer() } }];
  } catch (error) {
    console.warn(`bot/progress.png: left out, ${SOURCE} couldn't be rendered: ${(error as Error).message}`);
    return [];
  }
}

export function GET({ props }: APIContext) {
  return new Response(new Uint8Array((props as { png: Buffer }).png), { headers: { "Content-Type": "image/png" } });
}
