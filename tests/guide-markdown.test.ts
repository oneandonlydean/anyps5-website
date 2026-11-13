import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { guideMarkdown } from "../src/lib/text/guide";

const dir = resolve("src/content/guide");
const steps = readdirSync(dir).filter((f) => f.endsWith(".mdx"));
const site = new URL("https://anyps5.gg");

describe("setup guide as Markdown", () => {
  it.each(steps)("%s converts with no MDX left", (file) => {
    const body = readFileSync(resolve(dir, file), "utf8").replace(/^---[\s\S]*?---\n/, "");
    const text = guideMarkdown(body, site);
    const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    expect(prose).not.toMatch(/<\/?[A-Z]/);
    expect(prose).not.toMatch(/\]\(\/(?!\/)/);
  });

  it("turns callouts, tabs and screenshots into plain Markdown", () => {
    const text = guideMarkdown(
      '<Callout tone="warn" title="Careful">\nRead [the FAQ](/faq) first.\n</Callout>\n\n<Tabs>\n<Tab platform="linux">\n\nRun it.\n\n</Tab>\n</Tabs>\n\n<Screenshot\n  dark="/a.webp"\n  alt="The converter."\n/>',
      site,
    );
    expect(text).toBe("> **Warning: Careful**\n>\n> Read [the FAQ](https://anyps5.gg/faq.md) first.\n\n**On Linux:**\n\nRun it.\n\n*Screenshot: The converter.*");
  });

  it("fails on a component it has no text form for", () => {
    expect(() => guideMarkdown("<Video src='x' />", site)).toThrow(/Video/);
  });
});
