import type { APIContext } from "astro";
import { progressMap } from "../../lib/progress-map";

/**
 * Upstream's library map as a PNG, for the Discord bot's /progressmap and the map on /progress (src/lib/progress-map.ts).
 * When upstream can't be reached, the build leaves the image out and the command says so.
 */

export async function getStaticPaths() {
  const map = await progressMap();
  return map ? [{ params: { image: "progress" }, props: { png: map.png } }] : [];
}

export function GET({ props }: APIContext) {
  return new Response(new Uint8Array((props as { png: Buffer }).png), { headers: { "Content-Type": "image/png" } });
}
