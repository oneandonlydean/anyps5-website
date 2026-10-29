export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Lays out items as a squarified treemap (Bruls, Huizing and van Wijk) in a `width` × `height` box: each item gets an
 * area proportional to its value, in rows chosen to keep tiles close to square. Items should be sorted largest first.
 */
export function squarify<T>(items: T[], value: (item: T) => number, width: number, height: number): (T & Rect)[] {
  const total = items.reduce((sum, item) => sum + value(item), 0);
  const scale = (width * height) / total;
  const out: (T & Rect)[] = [];
  let box: Rect = { x: 0, y: 0, w: width, h: height };
  let row: T[] = [];

  // The worst aspect ratio in a row laid along a side of length `side`.
  const worst = (areas: number[], side: number) => {
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const areasOf = (list: T[]) => list.map((item) => value(item) * scale);

  const place = () => {
    const areas = areasOf(row);
    const sum = areas.reduce((a, b) => a + b, 0);
    const horizontal = box.w >= box.h;
    // A row fills the box's shorter side; its thickness is the row's area over that side.
    const thickness = sum / (horizontal ? box.h : box.w);
    let offset = 0;
    row.forEach((item, i) => {
      const length = areas[i] / thickness;
      out.push(
        horizontal
          ? { ...item, x: box.x, y: box.y + offset, w: thickness, h: length }
          : { ...item, x: box.x + offset, y: box.y, w: length, h: thickness },
      );
      offset += length;
    });
    box = horizontal
      ? { x: box.x + thickness, y: box.y, w: box.w - thickness, h: box.h }
      : { x: box.x, y: box.y + thickness, w: box.w, h: box.h - thickness };
    row = [];
  };

  for (const item of items) {
    if (value(item) <= 0) continue;
    const side = Math.min(box.w, box.h);
    if (row.length && worst(areasOf([...row, item]), side) > worst(areasOf(row), side)) place();
    row.push(item);
  }
  if (row.length) place();
  return out;
}
