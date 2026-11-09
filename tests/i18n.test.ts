import { describe, expect, it } from "vitest";
import { isTranslated, localePath, parsePath } from "../src/i18n/locales";
import { systemTokens } from "../src/lib/view";

describe("locale paths", () => {
  it("prefixes only pages that have translations", () => {
    expect(localePath("es", "/")).toBe("/es");
    expect(localePath("es", "/docs/guide/run")).toBe("/es/docs/guide/run");
    expect(localePath("ru", "/faq")).toBe("/ru/faq");
    expect(localePath("es", "/compatibility")).toBe("/compatibility");
    expect(localePath("en", "/docs/guide")).toBe("/docs/guide");
  });

  it("splits a URL into its language and English path", () => {
    expect(parsePath("/zh-cn/docs/guide/dump")).toEqual({ locale: "zh-cn", path: "/docs/guide/dump" });
    expect(parsePath("/es/")).toEqual({ locale: "es", path: "/" });
    expect(parsePath("/progress")).toEqual({ locale: "en", path: "/progress" });
    // A game slug that happens to start like a language stays English.
    expect(parsePath("/compatibility/ru-game")).toEqual({ locale: "en", path: "/compatibility/ru-game" });
  });

  it("knows which pages are translated", () => {
    expect(isTranslated("/")).toBe(true);
    expect(isTranslated("/docs/guide")).toBe(true);
    expect(isTranslated("/docs/guide/convert")).toBe(true);
    expect(isTranslated("/faq")).toBe(true);
    expect(isTranslated("/compatibility/hades-ii")).toBe(false);
  });
});

describe("system tokens", () => {
  const report = (platform: "linux" | "windows" | null, gpuVendor: string | null, stage: "Menus" | "Ingame" | "Starts", buildKind: "main" | "patched" = "main") =>
    ({ platform, gpuVendor, stage, buildKind }) as never;

  it("keeps the best stage per OS and GPU", () => {
    const game = { reports: [report("linux", "AMD", "Menus"), report("linux", "AMD", "Ingame"), report("windows", null, "Starts")], platforms: {} };
    expect(systemTokens(game, false).split(" ").sort()).toEqual(["linux:amd:6", "windows:any:2"]);
  });

  it("leaves out patched builds for main-only filtering, and counts curated platforms with any GPU", () => {
    const game = { reports: [report("linux", "NVIDIA", "Ingame", "patched")], platforms: { windows: "Menus" as const } };
    expect(systemTokens(game, true)).toBe("windows:any:5");
  });
});
