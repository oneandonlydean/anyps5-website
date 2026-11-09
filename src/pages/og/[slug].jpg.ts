import type { APIRoute, GetStaticPaths } from "astro";
import { getGames } from "../../lib/data";
import { gameImage } from "../../lib/og";
import { hostArt } from "../../lib/art";
import { reach } from "../../lib/view";

export const getStaticPaths = (async () => (await getGames()).map((game) => ({ params: { slug: game.slug }, props: { game } }))) satisfies GetStaticPaths;

export const GET: APIRoute<Awaited<ReturnType<typeof getStaticPaths>>[number]["props"]> = ({ props: { game } }) => {
  const { stage, onMain } = reach(game);
  const art = game.art;
  return gameImage({
    name: game.name,
    stage,
    onMain,
    cover: art?.cover ? hostArt(art.cover, 600) : null,
    hero: art?.hero ? hostArt(art.hero, 1280) : null,
    color: art?.color ?? null,
  });
};
