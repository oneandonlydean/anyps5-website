import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import { STAGE_HEX, STAGES, stageRank, type StageOrNone } from "./stages";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const CACHE = resolve(process.cwd(), "node_modules/.cache/anyps5-og");
const FONT_DIR = resolve(process.cwd(), "node_modules/@fontsource/geist/files");
const DISPLAY_DIR = resolve(process.cwd(), "node_modules/@fontsource/bricolage-grotesque/files");

const BG = "#06080d";
const TEXT = "#e9edf5";
const MUTED = "#8e98ab";
const UNTESTED = "#2a3142";

type Node = { type: string; props: Record<string, unknown> };
type Child = Node | string | null | false;

/** A satori element; satori needs `display: flex` on anything with more than one child. */
function h(type: string, style: Record<string, unknown>, ...children: Child[]): Node {
  return { type, props: { style: { display: "flex", ...style }, children: children.filter(Boolean) } };
}

function img(src: string, style: Record<string, unknown>): Node {
  return { type: "img", props: { src, style } };
}

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 600 | 700 | 800 }[]> | undefined;
function loadFonts() {
  fonts ??= Promise.all([
    ...([400, 600, 700] as const).map(async (weight) => ({ name: "Geist", weight, data: await readFile(resolve(FONT_DIR, `geist-latin-${weight}-normal.woff`)) })),
    // The site's display face, for headlines.
    ...([700, 800] as const).map(async (weight) => ({ name: "Bricolage", weight, data: await readFile(resolve(DISPLAY_DIR, `bricolage-grotesque-latin-${weight}-normal.woff`)) })),
  ]);
  return fonts;
}

/**
 * Fetches an image as a JPEG data URI no wider than it is drawn, cached on disk so rebuilds stay offline and fast.
 * Returns null on any failure.
 */
export async function imageData(url: string | null | undefined, width: number): Promise<string | null> {
  if (!url) return null;
  const file = resolve(CACHE, createHash("sha1").update(`${url} ${width}`).digest("hex"));
  try {
    return await readFile(file, "utf8");
  } catch {}
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const jpeg = await sharp(Buffer.from(await response.arrayBuffer())).resize({ width, withoutEnlargement: true }).flatten({ background: BG }).jpeg({ quality: 85 }).toBuffer();
    const data = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, data);
    return data;
  } catch {
    return null;
  }
}

async function render(tree: Node): Promise<Buffer> {
  const svg = await satori(tree as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts: await loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH } }).render().asPng();
  return sharp(png).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

// Rendering takes about half a second of blocking CPU per image, so finished images are cached by their inputs
// and by this module's own code: a rebuild redraws only what changed.
const design = readFile(fileURLToPath(import.meta.url)).then((code) => createHash("sha1").update(code).digest("hex"));

async function cached(inputs: unknown, draw: () => Promise<Buffer>): Promise<Response> {
  const key = createHash("sha1").update(await design).update(JSON.stringify(inputs)).digest("hex");
  const file = resolve(CACHE, `card-${key}.jpg`);
  const jpeg = await readFile(file).catch(async () => {
    const drawn = await draw();
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, drawn);
    return drawn;
  });
  return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg" } });
}

const mark = h(
  "div",
  { gap: 5, alignItems: "flex-end" },
  ...["#5b9bff", "#4fb0ee", "#37e0c8", "#8e98ab"].map((color) => h("div", { width: 7, height: 30, borderRadius: 2, background: color })),
);

const brand = (label: string) =>
  h("div", { alignItems: "center", gap: 14, fontSize: 28, fontWeight: 600, color: TEXT }, mark, h("div", { fontFamily: "Bricolage", fontWeight: 800 }, "AnyPS5"), h("div", { color: MUTED, fontWeight: 400 }, label));

export interface GameCard {
  name: string;
  stage: StageOrNone | null;
  onMain: boolean;
  cover: string | null;
  hero: string | null;
  color: string | null;
}

export function gameImage(game: GameCard): Promise<Response> {
  return cached(game, () => drawGame(game));
}

async function drawGame(game: GameCard): Promise<Buffer> {
  const [cover, hero] = await Promise.all([imageData(game.cover, 300), imageData(game.hero, OG_WIDTH)]);
  const rank = stageRank(game.stage);
  const tone = (game.stage && STAGE_HEX[game.stage]) || MUTED;
  const label = game.stage ?? "Not tested yet";
  const size = game.name.length > 28 ? 56 : 72;

  return render(
    h(
      "div",
      { width: "100%", height: "100%", background: game.color ?? BG, fontFamily: "Geist", position: "relative" },
      hero && img(hero, { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }),
      h("div", { position: "absolute", inset: 0, backgroundImage: `linear-gradient(90deg, ${BG} 30%, rgba(6,8,13,0.75) 65%, rgba(6,8,13,0.35))` }),
      h(
        "div",
        { position: "absolute", inset: 0, padding: "64px 72px", justifyContent: "space-between", alignItems: "center", gap: 56 },
        h(
          "div",
          { flexDirection: "column", justifyContent: "space-between", height: "100%", flex: 1 },
          brand("Compatibility"),
          h(
            "div",
            { flexDirection: "column", gap: 28 },
            h("div", { fontFamily: "Bricolage", fontSize: size, fontWeight: 800, color: TEXT, lineHeight: 1.02, letterSpacing: -1.5 }, game.name),
            h(
              "div",
              { alignItems: "center", gap: 16, fontSize: 32, fontWeight: 600, color: tone },
              label,
              !game.onMain && h("div", { fontSize: 22, color: MUTED, fontWeight: 400 }, "with open pull requests"),
            ),
            h(
              "div",
              { gap: 8 },
              ...STAGES.map((s, i) => h("div", { width: 72, height: 12, borderRadius: 6, background: i <= rank ? STAGE_HEX[s.name] : UNTESTED })),
            ),
          ),
        ),
        cover && img(cover, { width: 300, height: 450, borderRadius: 20, objectFit: "cover", boxShadow: "0 30px 60px rgba(0,0,0,0.5)" }),
      ),
    ),
  );
}

export function defaultImage(covers: string[]): Promise<Response> {
  return cached(covers, () => drawDefault(covers));
}

async function drawDefault(covers: string[]): Promise<Buffer> {
  const images = (await Promise.all(covers.map((c) => imageData(c, 170)))).filter((c): c is string => c !== null);
  return render(
    h(
      "div",
      { width: "100%", height: "100%", background: BG, fontFamily: "Geist", position: "relative", overflow: "hidden" },
      h(
        "div",
        { position: "absolute", top: -60, left: 560, gap: 20, flexWrap: "wrap", width: 760, transform: "rotate(-8deg)", opacity: 0.85 },
        ...images.map((src) => img(src, { width: 170, height: 255, borderRadius: 14, objectFit: "cover" })),
      ),
      h("div", { position: "absolute", inset: 0, backgroundImage: `linear-gradient(90deg, ${BG} 42%, rgba(6,8,13,0.6) 70%, rgba(6,8,13,0.1))` }),
      h(
        "div",
        { position: "absolute", inset: 0, padding: "72px", flexDirection: "column", justifyContent: "space-between" },
        brand(""),
        h(
          "div",
          { flexDirection: "column", gap: 24, width: 620 },
          h("div", { fontFamily: "Bricolage", fontSize: 78, fontWeight: 800, color: TEXT, lineHeight: 0.98, letterSpacing: -2 }, "PS5 games, running natively on PC."),
          h("div", { fontSize: 28, color: MUTED, lineHeight: 1.4 }, "Converter, setup guide and compatibility for every game."),
        ),
      ),
    ),
  );
}
