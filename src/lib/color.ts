/**
 * Accent colours derived from a game's art. Art colours are often dark or muddy, so only the hue is kept: each
 * accent is rebuilt in OKLCH at a lightness and chroma chosen for its theme, then brought back into the sRGB gamut.
 */

type Lch = { l: number; c: number; h: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function hexToOklch(hex: string): Lch {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklchToRgb({ l, c, h }: Lch): number[] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

/** An OKLCH colour as hex, lowering chroma until it fits sRGB so the hue survives. */
function oklchToHex(color: Lch): string {
  let c = color.c;
  let rgb = oklchToRgb({ ...color, c });
  while (rgb.some((v) => v < 0 || v > 1) && c > 0) {
    c -= 0.005;
    rgb = oklchToRgb({ ...color, c: Math.max(c, 0) });
  }
  return `#${rgb.map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export interface GameTheme {
  dark: { accent: string; strong: string; second: string };
  light: { accent: string; strong: string; second: string };
}

/** Accents for a game page, or null when the art is too grey to have a hue worth using. */
export function gameTheme(hex: string | null | undefined): GameTheme | null {
  if (!hex || !/^#[0-9a-f]{6}/i.test(hex)) return null;
  const { c, h } = hexToOklch(hex);
  if (c < 0.04) return null;
  const chroma = Math.min(Math.max(c, 0.11), 0.17);
  const at = (l: number, shift = 0) => oklchToHex({ l, c: chroma, h: (h + shift) % 360 });
  return {
    dark: { accent: at(0.76), strong: at(0.86), second: at(0.8, 40) },
    light: { accent: at(0.5), strong: at(0.42), second: at(0.54, 40) },
  };
}
