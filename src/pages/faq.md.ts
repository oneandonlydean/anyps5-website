import type { APIContext } from "astro";
import { markdownResponse } from "../lib/markdown";
import { faqText } from "../lib/text/pages";

/** The FAQ as Markdown, in English, for AI tools. */
export function GET({ site }: APIContext) {
  return markdownResponse(faqText(site));
}
