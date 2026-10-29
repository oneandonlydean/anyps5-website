import { getGames } from "../../lib/data";
import { getCoverage, getFunctions } from "../../lib/upstream";

/**
 * What the Worker checks uploaded run reports against: implemented functions, untranslated shader instructions, and
 * the title IDs of known games (for reports without one, where the uploader picks the game).
 */
export async function GET() {
  const [functions, coverage, games] = await Promise.all([getFunctions(), getCoverage(), getGames()]);
  const implemented = Object.entries(functions)
    .filter(([, [, done]]) => done)
    .map(([name]) => name);
  return new Response(JSON.stringify({ implemented, untranslated: coverage?.untranslated ?? [], titleIds: games.flatMap((g) => g.titleIds) }), { headers: { "Content-Type": "application/json" } });
}
