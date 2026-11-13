import type { APIContext } from "astro";
import { markdownResponse } from "../lib/markdown";
import { updatesText } from "../lib/text/updates";
import { getUpdates } from "../lib/updates";

/** The Updates page as Markdown, for AI tools. */
export async function GET({ site }: APIContext) {
  return markdownResponse(updatesText({ updates: await getUpdates(), site }));
}
