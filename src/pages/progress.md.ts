import type { APIContext } from "astro";
import { getGames, getNeeds } from "../lib/data";
import { markdownResponse } from "../lib/markdown";
import { progressText } from "../lib/text/progress";
import { getCommits, getCompatHistory, getCoverage, getProgress, getProgressHistory } from "../lib/upstream";

/** The progress page as Markdown, for AI tools. */
export async function GET({ site }: APIContext) {
  const [progress, libraryHistory, coverage, needs, games, compatHistory, commits] = await Promise.all([
    getProgress(),
    getProgressHistory(),
    getCoverage(),
    getNeeds(),
    getGames(),
    getCompatHistory(),
    getCommits(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return markdownResponse(progressText({ progress, libraryHistory, coverage, needs, games, compatHistory, commits, today, site }));
}
