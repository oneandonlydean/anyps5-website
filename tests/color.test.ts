import { describe, expect, it } from "vitest";
import { gameTheme } from "../src/lib/color";

/** WCAG contrast ratio between two hex colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("gameTheme", () => {
  it("skips grey or missing art", () => {
    expect(gameTheme("#7f7f80")).toBeNull();
    expect(gameTheme(null)).toBeNull();
    expect(gameTheme("not a colour")).toBeNull();
  });

  it("keeps a dark, muddy colour's hue but makes it readable on both themes", () => {
    const theme = gameTheme("#3a0d12")!;
    expect(theme).not.toBeNull();
    // Links in the accent must read on the dark surface and on the light one.
    expect(contrast(theme.dark.accent, "#0c1018")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.light.accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    // Still red: the red channel leads.
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(theme.dark.accent.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it("produces valid hex for every hue", () => {
    for (let h = 0; h < 360; h += 15) {
      const hex = `#${[0, 1, 2].map((k) => Math.round(127 + 100 * Math.cos(((h + k * 120) * Math.PI) / 180)).toString(16).padStart(2, "0")).join("")}`;
      const theme = gameTheme(hex);
      for (const set of [theme!.dark, theme!.light]) for (const value of Object.values(set)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
