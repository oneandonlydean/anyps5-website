import type { APIRoute } from "astro";
import { getGames } from "../../lib/data";
import { defaultImage } from "../../lib/og";
import { artSrc } from "../../lib/view";

export const GET: APIRoute = async () => {
  const covers = (await getGames()).flatMap((g) => (g.art?.cover ? [artSrc(g.art.cover, 360)] : [])).slice(0, 16);
  return defaultImage(covers);
};
