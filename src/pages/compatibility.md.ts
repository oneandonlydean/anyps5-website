import type { APIContext } from "astro";
import { getGames, getNeeds, getRetest } from "../lib/data";
import { markdownResponse } from "../lib/markdown";
import { compatibilityText } from "../lib/text/compatibility";

/** The compatibility list as Markdown, for AI tools. */
export async function GET({ site }: APIContext) {
  const [games, retest, needs] = await Promise.all([getGames(), getRetest(), getNeeds()]);
  return markdownResponse(compatibilityText({ games, retest, needs, site }));
}
