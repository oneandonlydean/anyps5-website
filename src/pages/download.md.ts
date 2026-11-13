import type { APIContext } from "astro";
import { markdownResponse } from "../lib/markdown";
import { downloadText } from "../lib/text/pages";
import { getRelease } from "../lib/upstream";

/** The download page as Markdown, for AI tools. */
export async function GET({ site }: APIContext) {
  return markdownResponse(downloadText(await getRelease(), site));
}
