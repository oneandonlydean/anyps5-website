/**
 * The site as plain Markdown, for AI tools and anything else that reads text rather than pages: /llms.txt indexes it,
 * and each page with something to say has a copy at the same address plus ".md" (/progress.md, /compatibility/<game>.md).
 * Built from the same data as the HTML, so the two always agree.
 */

import { DOCS } from "./docs";
import { BUILT_AT } from "./site";
import { STAGES, type StageOrNone } from "./stages";

const number = new Intl.NumberFormat("en-GB");

/** A count with thousands separators, as the pages print them. */
export const count = (n: number) => number.format(n);

/** "39.69%"; zero when there is nothing to count. */
export const percent = (done: number, total: number, digits = 2) => `${total ? ((done / total) * 100).toFixed(digits) : "0"}%`;

/** A date as YYYY-MM-DD, which reads the same everywhere and sorts. */
export const day = (iso: string) => iso.slice(0, 10);

/** Text for one table cell or list item: no line breaks, no pipes to break the row. */
export function inline(text: string | null | undefined): string {
  return (text ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
}

/** A GitHub-flavoured Markdown table. An empty cell shows as "—" so columns stay readable. */
export function table(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? "—" : inline(String(value)));
  return [`| ${headers.map(cell).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");
}

/** Code spans that hold any text: a run of backticks one longer than the longest inside. */
export function code(text: string): string {
  const fence = "`".repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  return /^`|`$/.test(text) ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/** Text quoted as-is from a report, in a fenced block that no backticks inside can close. */
export function quote(text: string): string {
  const fence = "`".repeat(Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  return `${fence}text\n${text.trim()}\n${fence}`;
}

/** An absolute link on this site, so a page fetched on its own still links correctly. */
export function link(site: URL | undefined, path: string): string {
  return site ? new URL(path, site).href : path;
}

/** Pages with a Markdown copy: the endpoints ending in .md.ts under src/pages. Any other path stays a link to the HTML page. */
const HAS_MARKDOWN = new RegExp(`^/(compatibility(/[^/#?.]+)?|progress|updates|download|faq|docs/guide/[^/#?.]+|docs/(${DOCS.map((d) => d.slug).join("|")}))$`);

/** The Markdown copy of a page on this site, or null when it has none: "/progress" → "/progress.md". */
export function markdownPath(path: string): string | null {
  return HAS_MARKDOWN.test(path) ? `${path}.md` : null;
}

/**
 * A link on this site, pointed at the page's Markdown copy when it has one: "/progress#games" → ".../progress.md#games".
 * Links elsewhere are left alone.
 */
export function textLink(site: URL | undefined, href: string): string {
  if (!href.startsWith("/")) return href;
  const [, path, rest] = href.match(/^([^#?]*)(.*)$/)!;
  const copy = markdownPath(path);
  return link(site, copy ? `${copy}${rest}` : href);
}

/** A stage with what it means, for the reader who doesn't know the ladder. */
export function stageLine(stage: StageOrNone | null): string {
  if (!stage) return "Untested";
  const meaning = STAGES.find((s) => s.name === stage)?.meaning;
  return meaning ? `${stage} (${meaning.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())})` : stage;
}

/** The ladder, best last, as one list: every Markdown page about games explains the stages the same way. */
export function stageLadder(): string {
  return [
    ...STAGES.map((s, i) => `${i + 1}. **${s.name}**: ${s.meaning}`),
    "",
    "**Not converting** means the converter itself fails on the game. **Untested** means nobody has reported on it yet.",
  ].join("\n");
}

/** The first lines of every Markdown page: what it is, where the HTML version is, and how fresh the data is. */
export function header(site: URL | undefined, title: string, path: string, summary?: string): string {
  return [
    `# ${title}`,
    "",
    ...(summary ? [`> ${summary}`, ""] : []),
    `Generated ${BUILT_AT.toISOString().slice(0, 16).replace("T", " ")} UTC from AnyPS5 data.`,
    "",
    `- HTML version: ${link(site, path)}`,
    `- Every text page: ${link(site, "/llms.txt")}`,
    "",
  ].join("\n");
}

/** Joins sections with a blank line between them and ends the file with a newline. */
export const join = (parts: (string | false | null | undefined)[]) =>
  `${parts
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .map((p) => p.trim())
    .join("\n\n")}\n`;

export function markdownResponse(text: string): Response {
  return new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}

export function textResponse(text: string): Response {
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
