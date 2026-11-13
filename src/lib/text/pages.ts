import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strings } from "../../i18n";
import { rewriteLink } from "../docs";
import { DATA } from "../load";
import { day, header, join, link, table, textLink } from "../markdown";
import { formatBytes, REPO_URL } from "../site";
import type { Release } from "../upstream";

/** An upstream doc (USAGE.md, INPUT_MAPPING.md) as Markdown, with its links pointed where the HTML version points them. */
export async function docText(doc: { slug: string; file: string; title: string; summary: string }, release: Release | null, site: URL | undefined): Promise<string> {
  const source = await readFile(resolve(DATA, "generated/docs", doc.file), "utf8").catch((error) => {
    if (error.code === "ENOENT") throw new Error(`${doc.file} is missing; run npm run fetch:upstream`);
    throw error;
  });
  const body = source
    .replace(/^# .*\n/, "")
    .replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, href: string, title: string) => `](${textLink(site, rewriteLink(href))}${title})`);
  return join([header(site, doc.title, `/docs/${doc.slug}`, doc.summary), release && `From the ${release.tag} release (${release.url}). This page updates with every release.`, body]);
}

/** HTML from the translation strings (links, bold, code, emphasis only) as Markdown. */
export function htmlToMarkdown(html: string, site: URL | undefined): string {
  return html
    .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, text: string) => `[${text}](${textLink(site, href)})`)
    .replace(/<\/?(b|strong)>/g, "**")
    .replace(/<\/?(em|i)>/g, "*")
    .replace(/<\/?code>/g, "`")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/** The FAQ as Markdown, in English. */
export function faqText(site: URL | undefined): string {
  const t = strings("en").faq;
  return join([
    header(site, "AnyPS5 FAQ", "/faq", htmlToMarkdown(t.lede, site)),
    ...t.groups.map((g) => [`## ${g.title}`, ...g.questions.map(({ q, a }) => `### ${q}\n\n${htmlToMarkdown(a, site)}`)].join("\n\n")),
  ]);
}

/** The download page as Markdown: the latest release and every file in it. */
export function downloadText(release: Release | null, site: URL | undefined): string {
  if (!release) return join([header(site, "Download AnyPS5", "/download"), `Release information is unavailable. Get the files from GitHub Releases: ${REPO_URL}/releases/latest`]);
  return join([
    header(site, `Download AnyPS5 ${release.tag}`, "/download", `${release.tag}, published ${day(release.published)}. Most people only need the web converter (${link(site, "/convert")}), which already includes the system libraries.`),
    [
      `- Release notes: ${release.url}`,
      "- Relinker (relinker-v*, .exe for Windows): the command-line converter. Handles any size of game and every option.",
      "- System libraries (prx-linux-*, prx-windows-*): AnyPS5's libraries, unpacked into libs/ next to the converted game. The web converter adds them for you.",
      `- How to use them: ${textLink(site, "/docs/guide/convert")}`,
    ].join("\n"),
    "## Files",
    table(
      ["File", "Size", "SHA-256", "Download"],
      release.assets.map((a) => [a.name, formatBytes(a.size), a.sha256, a.url]),
    ),
  ]);
}
