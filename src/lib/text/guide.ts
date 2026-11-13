import { textLink } from "../markdown";

const PLATFORM: Record<string, string> = { linux: "Linux", windows: "Windows", macos: "macOS" };

/** One attribute of a component tag, from `name="value"`. */
const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

/**
 * A setup guide step's MDX as plain Markdown: callouts become quotes, each platform tab a labelled section, a screenshot
 * its description, and site links point at the Markdown copies. A component this doesn't know fails the build, so new
 * MDX never leaks into the text as tags.
 */
export function guideMarkdown(body: string, site: URL | undefined): string {
  const out = body
    .replace(/^(import|export) .*$/gm, "")
    .replace(/<Screenshot\b[\s\S]*?\/>/g, (tag) => `*Screenshot: ${attribute(tag, "alt") ?? "the step above"}*`)
    .replace(/<Callout\b([^>]*)>([\s\S]*?)<\/Callout>/g, (_, attrs: string, text: string) => {
      const title = attribute(attrs, "title");
      const lines = [...(title ? [`**${attribute(attrs, "tone") === "warn" ? "Warning: " : ""}${title}**`, ""] : []), ...text.trim().split("\n")];
      return lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
    })
    .replace(/^<\/?Tabs>[ \t]*$/gm, "")
    .replace(/^<Tab\b([^>]*)>[ \t]*$/gm, (_, attrs: string) => {
      const key = attribute(attrs, "platform") ?? attribute(attrs, "label") ?? "";
      return `**On ${PLATFORM[key] ?? key}:**`;
    })
    .replace(/^<\/Tab>[ \t]*$/gm, "")
    // Links inside the site, outside code: [text](/path) → its Markdown copy, as an absolute address.
    .replace(/\]\((\/[^)\s]*)\)/g, (_, href: string) => `](${textLink(site, href)})`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const unknown = stripCode(out).match(/<[A-Z][A-Za-z]*\b/);
  if (unknown) throw new Error(`guideMarkdown: no text form for the MDX component ${unknown[0]}>; add one in src/lib/text/guide.ts`);
  return out;
}

/** The text outside fenced code blocks and code spans, where a "<Name" is only code. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}
