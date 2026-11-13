import type { APIContext } from "astro";
import { getBuilds, getRetest, getTested, getTrackedGames } from "../../lib/data";
import { markdownResponse } from "../../lib/markdown";
import { trackedText } from "../../lib/text/tracked";

/** The tracked games as Markdown, for AI tools. */
export async function GET({ site }: APIContext) {
  const [games, builds, tested, retest] = await Promise.all([getTrackedGames(), getBuilds(), getTested(), getRetest()]);
  return markdownResponse(trackedText({ games, builds, tested, retest, site }));
}
