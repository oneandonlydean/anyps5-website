import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Marked } from "marked";
import { getHeadingList, gfmHeadingId } from "marked-gfm-heading-id";
import { DATA } from "./load";
import { REPO_URL } from "./site";

/** Upstream docs shipped with every release, rendered at /docs/<slug>. */
export const DOCS = [
  { slug: "usage", file: "USAGE.md", title: "Relinker usage", summary: "Conversion, options, game patches, the runtime layout and every runtime switch." },
  { slug: "input-mapping", file: "INPUT_MAPPING.md", title: "Input mapping", summary: "Controllers, default keyboard and mouse bindings, and anyps5-input.ini." },
] as const;

export interface Heading {
  depth: number;
  id: string;
  text: string;
}

const UPSTREAM_DOCS = "docs/user/";
const UPSTREAM_PAGES = "https://boykopovar.github.io/AnyPS5/";

/** Points links that are relative to docs/user/ upstream at this site or at the repository. */
export function rewriteLink(href: string): string {
  if (href === UPSTREAM_PAGES) return "/convert";
  if (/^[a-z]+:|^#/i.test(href)) return href;
  const [path, hash] = href.split("#");
  const doc = DOCS.find((d) => d.file === path);
  if (doc) return `/docs/${doc.slug}${hash ? `#${hash}` : ""}`;
  return new URL(href, `${REPO_URL}/blob/main/${UPSTREAM_DOCS}`).href;
}

export async function renderDoc(file: string): Promise<{ html: string; headings: Heading[] }> {
  const source = await readFile(resolve(DATA, "generated/docs", file), "utf8").catch((error) => {
    if (error.code === "ENOENT") throw new Error(`${file} is missing; run npm run fetch:upstream`);
    throw error;
  });
  const marked = new Marked(gfmHeadingId(), {
    walkTokens(token) {
      if (token.type === "link") token.href = rewriteLink(token.href);
    },
  });
  // The page supplies its own h1.
  const html = await marked.parse(source.replace(/^# .*\n/, ""));
  const headings = getHeadingList()
    .filter((h) => h.level <= 3)
    .map((h) => ({ depth: h.level, id: h.id, text: h.raw.replace(/`/g, "") }));
  return { html: html.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>"), headings };
}
