import type { APIContext } from "astro";
import { getBuilds, getGames, getNeeds, getRetest, getScreenshots, getTested } from "../../lib/data";
import { markdownResponse } from "../../lib/markdown";
import type { Game } from "../../lib/resolve";
import { gameText } from "../../lib/text/game";

export async function getStaticPaths() {
  return (await getGames()).map((game) => ({ params: { slug: game.slug }, props: { game } }));
}

/** A game page as Markdown, for AI tools: /compatibility/<slug>.md next to the page itself. */
export async function GET({ site, props }: APIContext) {
  const game = (props as { game: Game }).game;
  const [needs, retest, tested, builds, shots] = await Promise.all([getNeeds(), getRetest(), getTested(), getBuilds(), getScreenshots()]);
  return markdownResponse(
    gameText({ game, needs: needs.get(game.slug), retest: retest.get(game.slug)!, tested: tested.get(game.slug)!, builds, shots: shots.get(game.slug) ?? [], site }),
  );
}
