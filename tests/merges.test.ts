import { describe, expect, it } from "vitest";
import { classify } from "../src/lib/merges";

const merge = (title: string, labels: string[] = []) => ({ number: 1, title, mergedAt: "2026-10-29T07:48:26Z", author: "dev", labels });

describe("classify", () => {
  it.each([
    ["feat(libkernel): implement the unnamed ksem semaphores", "libraries", "libkernel", true],
    ["fix(libSceFont): keep horizontal writing on a single baseline", "libraries", "libSceFont", true],
    ["perf(agc): read the flag once in the held-read check", "gpu", null, true],
    ["perf(shader): bypass identity fragment export mappings", "shader", null, true],
    ["fix(relinker): keep the TLS segment aligned", "relinker", null, true],
    ["feat(web): show the library download size", "converter", null, true],
    ["test(libc): cover strtod rounding", "libraries", "libc", false],
    ["docs(tools): explain the bisect helper", "project", null, false],
    ["fix(tools): handle empty logs", "project", null, false],
  ])("%s", (title, area, library, notable) => {
    expect(classify(merge(title))).toMatchObject({ area, library, notable });
  });

  it("strips the prefix, falls back on labels, and finds title IDs", () => {
    const c = classify(merge("fix: blend into unclamped targets for PPSA21564", ["agc"]));
    expect(c).toMatchObject({ type: "fix", area: "gpu", summary: "blend into unclamped targets for PPSA21564", titleIds: ["PPSA21564"] });
    expect(c.url).toBe("https://github.com/boykopovar/AnyPS5/pull/1");
  });

  it("reads reverts without a conventional prefix", () => {
    expect(classify(merge('Revert "report 12 GiB of direct memory" (#10809)', ["libkernel"]))).toMatchObject({ type: "revert", area: "libraries", notable: true });
  });
});
