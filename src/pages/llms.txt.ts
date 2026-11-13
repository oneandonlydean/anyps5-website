import type { APIContext } from "astro";
import { getGames } from "../lib/data";
import { getSteps } from "../lib/guide";
import { textResponse } from "../lib/markdown";
import { llmsText } from "../lib/text/llms";
import { getCoverage, getProgress, getRelease } from "../lib/upstream";

/** The index of the site's Markdown copies, for AI tools (https://llmstxt.org). */
export async function GET({ site }: APIContext) {
  const [release, progress, coverage, games, steps] = await Promise.all([getRelease(), getProgress(), getCoverage(), getGames(), getSteps()]);
  return textResponse(llmsText({ release, progress, coverage, games, steps: steps.map((s) => ({ slug: s.slug, title: s.entry.data.title, summary: s.entry.data.summary })), site }));
}
