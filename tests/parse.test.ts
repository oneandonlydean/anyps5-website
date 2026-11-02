import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { answer, buildKindOf, formSections, gpuOf, inlineField, issueRefs, parseReport, platformOf, postImages, stageFromFurthest, titleIds } from "../src/lib/parse";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), "utf8");
const meta = { url: "https://github.com/boykopovar/AnyPS5/discussions/1", discussion: 1, author: "tester", date: "2026-10-20T00:00:00Z" };

describe("stageFromFurthest", () => {
  it.each([
    ["Does not convert", "Not converting"],
    ["Logos or loading screen", "Presents"],
    ["Menu", "Menus"],
    ["Menu — title screen and licence prompt", "Menus"],
    ["In game", "Ingame"],
    ["In-game (playable: profile creation)", "Ingame"],
    ["Playable at 60 fps on plain main", "Playable"],
    ["Boots (presents frames, all black)", "Presents"],
    ["Boots (stops 4 s in, before the first frame)", "Starts"],
    ["Intro cutscene of a new game", "Presents"],
    ["Not in game. No frame has been presented yet.", null],
    ["Something else entirely", null],
  ])("%s → %s", (text, stage) => expect(stageFromFurthest(text)).toBe(stage));

  it("splits 'before the first frame' on whether imports resolved", () => {
    expect(stageFromFurthest("Stops before the first frame", "unresolved ELF import sceFoo")).toBe("Converts");
    expect(stageFromFurthest("Stops before the first frame", "compute shader aborts")).toBe("Starts");
  });
});

describe("field readers", () => {
  it("reads only the checked box", () => {
    expect(answer("- [ ] Does not convert\n- [x] Menu\n- [ ] In game")).toBe("Menu");
    expect(answer("- [ ] Does not convert\n- [ ] Menu")).toBeNull();
  });

  it("reads inline bold fields", () => {
    expect(inlineField("* **Furthest Point:** Stop Before First Frame", ["furthest point"])).toBe("Stop Before First Frame");
  });

  it("finds title IDs and issue references", () => {
    expect(titleIds("Ghost of Yōtei (PPSA26344) and cusa-12345")).toEqual(["PPSA26344", "CUSA12345"]);
    expect(issueRefs("#11691 fixes it, see https://github.com/boykopovar/AnyPS5/pull/8223 and colour &#123;")).toEqual([8223, 11691]);
  });

  it("classifies systems and builds", () => {
    expect(platformOf("Arch Linux, GCC 16.2.1")).toBe("linux");
    expect(platformOf("Windows 11, MinGW")).toBe("windows");
    expect(gpuOf("AMD Radeon RX 9070 XT with RADV")).toEqual({ gpu: "AMD Radeon RX 9070 XT", vendor: "AMD" });
    expect(gpuOf("RTX 5080 (NVIDIA 615.78)")).toEqual({ gpu: "RTX 5080", vendor: "NVIDIA" });
    expect(buildKindOf("`main` a120df3486")).toBe("main");
    expect(buildKindOf("a120df3486")).toBe("main");
    expect(buildKindOf("main plus #11691")).toBe("prs");
    expect(buildKindOf("e61a7c7e24 (with branch feat/appcontent)")).toBe("patched");
  });
});

describe("parseReport on real posts", () => {
  it("parses a bring-up form", () => {
    const report = parseReport(fixture("form"), meta)!;
    expect(report).toMatchObject({ stage: "Presents", platform: "linux", gpuVendor: "AMD", buildKind: "main", version: "01.007.000" });
    expect(report.blockers).toContain(11691);
  });

  it("parses a form answered with checkboxes", () => {
    expect(parseReport(fixture("checkboxes"), meta)?.stage).toMatch(/Converts|Starts/);
  });

  it("parses an inline update reply", () => {
    expect(parseReport(fixture("inline"), meta)?.stage).toMatch(/Converts|Starts/);
  });

  it("ignores a freeform post without a furthest point", () => {
    expect(parseReport(fixture("freeform"), meta)).toBeNull();
  });

  it("keeps form sections keyed by heading", () => {
    expect(formSections(fixture("form"))["content version tested"]).toBe("01.007.000");
  });
});

describe("postImages", () => {
  it("reads Markdown and HTML images, with alt text", () => {
    const body = [
      "![Main menu](https://raw.githubusercontent.com/u/r/main/menu.png)",
      '<img width="1920" alt="In game" src="https://github.com/user-attachments/assets/abc" />',
      "![](https://files.catbox.moe/x.png \"title\")",
    ].join("\n");
    expect(postImages(body)).toEqual([
      { src: "https://raw.githubusercontent.com/u/r/main/menu.png", alt: "Main menu" },
      { src: "https://github.com/user-attachments/assets/abc", alt: "In game" },
      { src: "https://files.catbox.moe/x.png", alt: "" },
    ]);
  });

  it("reads HTML images with unquoted attributes", () => {
    const body = [
      "<img width=763 height=454 alt={4D867433-FCEF-4259-B717-30446CAD249B} src=https://github.com/user-attachments/assets/780f090b />",
      "<img alt=menu src=https://example.com/b.png/>",
    ].join("\n");
    expect(postImages(body)).toEqual([
      { src: "https://github.com/user-attachments/assets/780f090b", alt: "{4D867433-FCEF-4259-B717-30446CAD249B}" },
      { src: "https://example.com/b.png", alt: "menu" },
    ]);
  });

  it("skips code, badges, duplicates and non-http sources", () => {
    const body = [
      "```\n![log](https://example.com/in-code.png)\n```",
      "`![inline](https://example.com/inline.png)`",
      "![badge](https://img.shields.io/badge/x-y-green)",
      "![icon](https://example.com/icon.svg)",
      '<img src="javascript:alert(1)">',
      "![a](https://example.com/a.png) ![a again](https://example.com/a.png)",
    ].join("\n");
    expect(postImages(body)).toEqual([{ src: "https://example.com/a.png", alt: "a" }]);
  });
});

describe("what is shown", () => {
  it("keeps every paragraph a tester wrote, not just the start of the first", () => {
    const long = "Six runs on this commit. ".repeat(20).trim();
    const body = `### Furthest point\n\nIn game\n\n### What is shown\n\n${long}\n\nThen it  \`hangs\`\non a black screen.\n\n### Current blocker\n\nNone`;
    expect(parseReport(body, meta)?.shown).toBe(`${long}\n\nThen it hangs on a black screen.`);
  });
});

describe("what is shown, with a list", () => {
  it("keeps a list's items one per line and drops emphasis", () => {
    const body = "### Furthest point\n\nIn game\n\n### What is shown\n\nIt boots.\n\n- **First** run: fine.\n- `Second` run:\n  also fine.\n\n### Current blocker\n\nNone";
    expect(parseReport(body, meta)?.shown).toBe("It boots.\n\n- First run: fine.\n- Second run: also fine.");
  });
});
