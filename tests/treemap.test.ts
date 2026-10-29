import { describe, expect, it } from "vitest";
import { squarify } from "../src/lib/treemap";

describe("squarify", () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ id: i, v }));
  const tiles = squarify(items, (i) => i.v, 6, 4);

  it("gives every item an area proportional to its value", () => {
    for (const t of tiles) expect(t.w * t.h).toBeCloseTo(t.v, 6);
  });

  it("keeps tiles inside the box without overlap", () => {
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(6 + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(4 + 1e-9);
    }
    for (const a of tiles)
      for (const b of tiles) {
        if (a === b) continue;
        const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-9;
        expect(overlap).toBe(false);
      }
  });

  it("skips empty items", () => {
    expect(squarify([{ v: 0 }, { v: 1 }], (i) => i.v, 1, 1)).toHaveLength(1);
  });
});
