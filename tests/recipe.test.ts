import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRecipe, commandLine, environmentLines, validateRecipe } from "../src/lib/recipe";
import { validateRunReport, type RunReport } from "../src/lib/run-report";

const report = validateRunReport(JSON.parse(readFileSync(new URL("./fixtures/run-reports/stop-none.json", import.meta.url), "utf8"))).report as RunReport;

/** A recipe as upstream's SerializeRecipe writes it. */
const sample = () => ({
  format: "anyps5-recipe",
  version: 1,
  generated: "2026-11-13T10:00:00Z",
  run: { id: report.run.id },
  anyps5: { commit: report.anyps5.commit },
  argv: ["[redacted]", "--game", "PPSA34502/eboot.elf"],
  environment: { ANYPS5_INPUT_CONFIG: "[redacted]", ANYPS5_VSYNC: "0" },
  configFiles: ["pad.toml"],
});

describe("validateRecipe", () => {
  it("accepts what the runtime writes, keeping only the fields the site knows", () => {
    const { recipe, issues } = validateRecipe({ ...sample(), somethingNew: true });
    expect(issues).toEqual([]);
    expect(recipe).toEqual(sample());
  });

  it("refuses what isn't a recipe, saying where", () => {
    expect(validateRecipe({ ...sample(), format: "anyps5-report" }).issues[0]).toContain("format");
    expect(validateRecipe({ ...sample(), run: { id: "nope" } }).issues[0]).toContain("run/id");
    expect(validateRecipe({ ...sample(), environment: { PATH: "/usr/bin" } }).issues[0]).toContain("environment");
    expect(validateRecipe({ ...sample(), argv: "anyps5 game" }).issues[0]).toContain("argv");
  });

  it("leaves out anything named like a secret, as the runtime does", () => {
    const { recipe } = validateRecipe({
      ...sample(),
      argv: ["anyps5", "--token=abc123", "--password", "hunter2", "--fullscreen", "API_KEY:xyz"],
      environment: { ANYPS5_GITHUB_TOKEN: "ghp_x", ANYPS5_PSN_LOGIN: "me", ANYPS5_VSYNC: "0" },
    });
    expect(recipe!.argv).toEqual(["anyps5", "--token=[redacted]", "--password", "[redacted]", "--fullscreen", "API_KEY:[redacted]"]);
    expect(recipe!.environment).toEqual({ ANYPS5_VSYNC: "0" });
  });
});

describe("checkRecipe", () => {
  it("needs the report's run, and the same build", () => {
    const recipe = validateRecipe(sample()).recipe!;
    expect(checkRecipe(report, recipe)).toEqual([]);
    expect(checkRecipe(report, { ...recipe, run: { id: "0".repeat(32) } })[0]).toContain("another run");
    expect(checkRecipe(report, { ...recipe, anyps5: { commit: "f".repeat(40) } })).toHaveLength(report.anyps5.commit ? 1 : 0);
    expect(checkRecipe(report, { ...recipe, anyps5: { commit: null } })).toEqual([]);
  });
});

describe("commandLine", () => {
  it("quotes only the arguments a shell would split or expand", () => {
    expect(commandLine(["anyps5", "--game", "My Game/eboot.elf", "it's", ""])).toBe(`anyps5 --game 'My Game/eboot.elf' 'it'\\''s' ''`);
    expect(environmentLines({ ANYPS5_VSYNC: "0", ANYPS5_NAME: "a b" })).toEqual(["ANYPS5_VSYNC=0", "ANYPS5_NAME='a b'"]);
  });
});
