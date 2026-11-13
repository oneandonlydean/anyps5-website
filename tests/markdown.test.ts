import { describe, expect, it } from "vitest";
import { code, inline, markdownPath, quote, table, textLink } from "../src/lib/markdown";

const site = new URL("https://anyps5.gg");

describe("markdown helpers", () => {
  it("keeps table rows on one line whatever the text holds", () => {
    expect(table(["A", "B"], [["x | y", "one\ntwo"], [null, 3]])).toBe("| A | B |\n| --- | --- |\n| x \\| y | one two |\n| — | 3 |");
    expect(inline("  a\n\n  b ")).toBe("a b");
  });

  it("fences code and quotes so backticks inside can't close them", () => {
    expect(code("sceKernelOpen")).toBe("`sceKernelOpen`");
    expect(code("a`b")).toBe("``a`b``");
    expect(quote("log ```\nmore")).toBe("````text\nlog ```\nmore\n````");
  });

  it("points links at pages' Markdown copies when they have one", () => {
    expect(markdownPath("/progress")).toBe("/progress.md");
    expect(markdownPath("/compatibility/hades-ii")).toBe("/compatibility/hades-ii.md");
    expect(markdownPath("/docs/guide/run")).toBe("/docs/guide/run.md");
    expect(markdownPath("/docs/usage")).toBe("/docs/usage.md");
    expect(markdownPath("/convert")).toBeNull();
    expect(markdownPath("/compatibility/hades-ii.xml")).toBeNull();
    expect(textLink(site, "/progress#games")).toBe("https://anyps5.gg/progress.md#games");
    expect(textLink(site, "/convert")).toBe("https://anyps5.gg/convert");
    expect(textLink(site, "https://github.com/x")).toBe("https://github.com/x");
  });
});
