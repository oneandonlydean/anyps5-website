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

// The logo mark (src/assets/logo/mark.svg), drawn light on the dark cards.
const markSvg = await readFile(resolve(process.cwd(), "src/assets/logo/mark.svg"), "utf8");
const markUri = `data:image/svg+xml;base64,${Buffer.from(markSvg.replace('fill="currentColor"', `fill="${TEXT}"`)).toString("base64")}`;
const mark = () => img(markUri, { width: 33, height: 30 });

const brand = (label: string) =>
  h("div", { alignItems: "center", gap: 14, fontSize: 28, fontWeight: 600, color: TEXT }, mark(), h("div", { fontFamily: "Bricolage", fontWeight: 800 }, "AnyPS5"), h("div", { color: MUTED, fontWeight: 400 }, label));

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

export interface ProgressCard {
  date: string;
  libraries: { done: number; total: number } | null;
  shaders: { decoded: number; total: number } | null;
  /** Games per furthest stage, best first, and how many were tested. */
  games: { stages: { stage: StageOrNone; count: number }[]; tested: number; gameplay: number };
  /** Commits on main for each of the last days, oldest first; the last may be a partial day. */
  commits: { date: string; commits: number }[];
}

/** The picture for the Discord bot's /progress: the three headline figures and recent commits, sized to read small. */
export function progressImage(card: ProgressCard): Promise<Response> {
  return cached(card, () => render(drawProgress(card)));
}

const SURFACE = "#0c1018";
const LINE = "#1c2333";
const number = new Intl.NumberFormat("en-GB");
/** One decimal near either end, so 99.7% doesn't read as complete or 0.4% as nothing. */
function share(done: number, total: number): string {
  const p = total ? (done / total) * 100 : 0;
  const near = (p > 0 && p < 10) || (p > 99 && p < 100);
  return `${(Math.floor(p * (near ? 10 : 1)) / (near ? 10 : 1)).toFixed(near ? 1 : 0)}%`;
}

// Satori sizes flex boxes to their text rather than shrinking them, so widths are worked out here (border-box).
const PAD = 48;
const GAP = 20;
const TILE = Math.floor((OG_WIDTH - 2 * PAD - 2 * GAP) / 3);
const LEAD = 280;
const SPARK = OG_WIDTH - 2 * PAD - LEAD - 28;

function tile(eyebrow: string, color: string, big: string, small: string, bar: Node): Node {
  return h(
    "div",
    { width: TILE, boxSizing: "border-box", flexShrink: 0, flexDirection: "column", justifyContent: "space-between", padding: "26px 28px", background: SURFACE, border: `2px solid ${LINE}`, borderRadius: 22 },
    h("div", { alignItems: "center", gap: 12, fontSize: 22, fontWeight: 600, letterSpacing: 2, color: MUTED }, h("div", { width: 12, height: 12, borderRadius: 6, background: color }), eyebrow),
    h(
      "div",
      { flexDirection: "column", gap: 6 },
      h("div", { fontFamily: "Bricolage", fontSize: 80, fontWeight: 800, color: TEXT, lineHeight: 1, letterSpacing: -2 }, big),
      h("div", { fontSize: 24, color: MUTED, lineHeight: 1.25 }, small),
    ),
    bar,
  );
}

const meterBar = (done: number, total: number, color: string) =>
  h("div", { height: 14, borderRadius: 7, background: UNTESTED, overflow: "hidden" }, h("div", { width: `${total ? Math.max(1, (done / total) * 100) : 0}%`, height: "100%", background: color, borderRadius: 7 }));

function drawProgress(card: ProgressCard): Node {
  const { libraries, shaders, games, commits } = card;
  const stageBar = h(
    "div",
    { height: 14, gap: 3, minWidth: 0 },
    ...games.stages.filter((s) => s.count > 0).map((s) => h("div", { flexGrow: s.count, flexBasis: 0, minWidth: 0, height: "100%", borderRadius: 4, background: STAGE_HEX[s.stage] })),
  );
  const peak = Math.max(1, ...commits.map((d) => d.commits));
  const full = commits.slice(0, -1);
  const week = full.slice(-7).reduce((n, d) => n + d.commits, 0);
  return h(
    "div",
    { width: OG_WIDTH, height: OG_HEIGHT, boxSizing: "border-box", flexDirection: "column", gap: 24, padding: `40px ${PAD}px`, background: BG, fontFamily: "Geist" },
    h(
      "div",
      { justifyContent: "space-between", alignItems: "center" },
      brand("Progress"),
      h("div", { fontSize: 24, color: MUTED }, new Date(`${card.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })),
    ),
    h(
      "div",
      { gap: GAP, flex: 1, minHeight: 0 },
      libraries
        ? tile("LIBRARIES", "#5b9bff", share(libraries.done, libraries.total), `${number.format(libraries.done)} of ${number.format(libraries.total)} functions`, meterBar(libraries.done, libraries.total, "#5b9bff"))
        : null,
      shaders ? tile("SHADERS", "#37e0c8", share(shaders.decoded, shaders.total), `of ${number.format(shaders.total)} GPU instructions decode`, meterBar(shaders.decoded, shaders.total, "#37e0c8")) : null,
      tile("GAMES", STAGE_HEX.Ingame, number.format(games.gameplay), `of ${number.format(games.tested)} tested reach gameplay`, stageBar),
    ),
    commits.length > 1 &&
      h(
        "div",
        { alignItems: "flex-end", gap: 28, height: 84, flexShrink: 0 },
        h(
          "div",
          { flexDirection: "column", width: LEAD, flexShrink: 0, gap: 2 },
          h("div", { fontFamily: "Bricolage", fontSize: 44, fontWeight: 800, color: TEXT, lineHeight: 1 }, number.format(week)),
          h("div", { fontSize: 22, color: MUTED }, "commits in the last 7 days"),
        ),
        h(
          "div",
          { width: SPARK, flexShrink: 0, height: "100%", alignItems: "flex-end", gap: 4 },
          ...commits.map((d, i) =>
            h("div", { width: (SPARK - 4 * (commits.length - 1)) / commits.length, flexShrink: 0, height: `${Math.max(3, (d.commits / peak) * 100)}%`, borderRadius: "4px 4px 0 0", background: "#5b9bff", opacity: i === commits.length - 1 ? 0.35 : 1 }),
          ),
        ),
      ),
  );
}

// The in-depth cards for /progress libraries, shaders and games: the headline on the left, labelled bars on the right.

const LEFT = 330;
const RIGHT = OG_WIDTH - 2 * PAD - LEFT - 48;

const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function frame(label: string, date: string, left: Child[], right: Child[]): Node {
  return h(
    "div",
    { width: OG_WIDTH, height: OG_HEIGHT, boxSizing: "border-box", flexDirection: "column", gap: 28, padding: `40px ${PAD}px`, background: BG, fontFamily: "Geist" },
    h("div", { justifyContent: "space-between", alignItems: "center" }, brand(label), h("div", { fontSize: 24, color: MUTED }, dateLabel(date))),
    h(
      "div",
      { flex: 1, gap: 48, minHeight: 0 },
      h("div", { width: LEFT, flexShrink: 0, flexDirection: "column", justifyContent: "space-between" }, ...left),
      h("div", { width: RIGHT, flexShrink: 0, flexDirection: "column", boxSizing: "border-box", padding: "26px 30px", background: SURFACE, border: `2px solid ${LINE}`, borderRadius: 22 }, ...right),
    ),
  );
}

function headline(eyebrow: string, color: string, big: string, small: string): Node {
  return h(
    "div",
    { flexDirection: "column", gap: 10, width: LEFT },
    h("div", { alignItems: "center", gap: 12, fontSize: 22, fontWeight: 600, letterSpacing: 2, color: MUTED }, h("div", { width: 12, height: 12, borderRadius: 6, background: color }), eyebrow),
    h("div", { fontFamily: "Bricolage", fontSize: 104, fontWeight: 800, color: TEXT, lineHeight: 1, letterSpacing: -3, marginTop: 8 }, big),
    h("div", { fontSize: 26, color: MUTED, lineHeight: 1.3 }, small),
  );
}

/** A short list of figures under the headline, each with a coloured dot. */
const facts = (rows: { color: string; text: string }[]) =>
  h(
    "div",
    { flexDirection: "column", gap: 10, width: LEFT },
    ...rows.map((r) => h("div", { alignItems: "center", gap: 12, fontSize: 24, color: TEXT }, h("div", { width: 10, height: 10, borderRadius: 5, background: r.color }), r.text)),
  );

interface Row {
  label: string;
  /** Bar length as a share of the track, 0 to 1. */
  share: number;
  value: string;
  color: string;
}

const NAME = 210;
const VALUE = 150;

function rows(title: string, items: Row[]): Node[] {
  const track = RIGHT - 60 - NAME - VALUE - 32;
  const height = items.length > 7 ? 30 : 36;
  return [
    h("div", { fontSize: 24, fontWeight: 600, color: TEXT, marginBottom: 18 }, title),
    h(
      "div",
      { flexDirection: "column", flex: 1, justifyContent: "space-between" },
      ...items.map((r) =>
        h(
          "div",
          { alignItems: "center", gap: 16, height },
          h("div", { width: NAME, flexShrink: 0, fontSize: 22, color: TEXT, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, r.label),
          h(
            "div",
            { width: track, flexShrink: 0, height: 14, borderRadius: 7, background: UNTESTED },
            h("div", { width: Math.max(r.share > 0 ? 6 : 0, Math.round(r.share * track)), height: 14, borderRadius: 7, background: r.color }),
          ),
          h("div", { width: VALUE, flexShrink: 0, justifyContent: "flex-end", fontSize: 22, color: MUTED }, r.value),
        ),
      ),
    ),
  ];
}

export interface LibrariesCard {
  date: string;
  done: number;
  total: number;
  complete: number;
  started: number;
  untouched: number;
  biggest: { name: string; done: number; total: number }[];
}

export const librariesImage = (card: LibrariesCard) =>
  cached(card, () =>
    render(
      frame(
        "Libraries",
        card.date,
        [
          headline("SYSTEM LIBRARIES", "#5b9bff", share(card.done, card.total), `${number.format(card.done)} of ${number.format(card.total)} functions implemented`),
          facts([
            { color: "#3ddc84", text: `${number.format(card.complete)} libraries complete` },
            { color: "#5b9bff", text: `${number.format(card.started)} in progress` },
            { color: UNTESTED, text: `${number.format(card.untouched)} not started` },
          ]),
        ],
        rows(
          "Biggest libraries",
          card.biggest.map((l) => ({ label: l.name, share: l.total ? l.done / l.total : 0, value: `${number.format(l.done)} / ${number.format(l.total)}`, color: l.done === l.total ? "#3ddc84" : "#5b9bff" })),
        ),
      ),
    ),
  );

export interface ShadersCard {
  date: string;
  instructions: { total: number; decoded: number; translated: number };
  dpp: { total: number; decoded: number } | null;
  formats: { total: number; sampled: number; buffer: number; host: number } | null;
  throws: { total: number; areas: { name: string; count: number }[] };
}

export const shadersImage = (card: ShadersCard) => {
  const { instructions: i, dpp, formats: f, throws } = card;
  const meterRow = (label: string, done: number, total: number, color: string): Row => ({ label, share: total ? done / total : 0, value: share(done, total), color });
  return cached(card, () =>
    render(
      frame(
        "Shaders",
        card.date,
        [
          headline("SHADER RECOMPILER", "#37e0c8", share(i.decoded, i.total), `of ${number.format(i.total)} RDNA 2 instructions decode`),
          facts([
            { color: "#f5b84a", text: `${number.format(throws.total)} places still stop` },
            ...throws.areas.slice(0, 3).map((a) => ({ color: UNTESTED, text: `${a.name} · ${number.format(a.count)}` })),
          ]),
        ],
        rows("Coverage", [
          meterRow("Decode", i.decoded, i.total, "#37e0c8"),
          meterRow("Translate", i.translated, i.total, "#37e0c8"),
          ...(dpp ? [meterRow("DPP forms", dpp.decoded, dpp.total, "#37e0c8")] : []),
          ...(f
            ? [meterRow("Sampled formats", f.sampled, f.total, "#5b9bff"), meterRow("Buffer formats", f.buffer, f.total, "#5b9bff"), meterRow("Vulkan formats", f.host, f.total, "#5b9bff")]
            : []),
        ]),
      ),
    ),
  );
};

export interface GamesCard {
  date: string;
  tested: number;
  gameplay: number;
  /** Change in games reaching gameplay over the last 7 days. */
  week: number | null;
  /** Games per furthest stage, best first. */
  stages: { stage: StageOrNone; count: number }[];
}

export const gamesImage = (card: GamesCard) => {
  const peak = Math.max(1, ...card.stages.map((s) => s.count));
  const week = card.week === null ? null : card.week === 0 ? "No change this week" : `${card.week > 0 ? "+" : "−"}${number.format(Math.abs(card.week))} at gameplay this week`;
  return cached(card, () =>
    render(
      frame(
        "Games",
        card.date,
        [
          headline("GAMES", STAGE_HEX.Ingame, number.format(card.gameplay), `of ${number.format(card.tested)} tested games reach gameplay`),
          facts([...(week ? [{ color: STAGE_HEX.Ingame, text: week }] : []), { color: STAGE_HEX.Playable, text: `${number.format(card.stages.find((s) => s.stage === "Playable")?.count ?? 0)} playable` }]),
        ],
        rows(
          "Furthest stage reached",
          card.stages.map((s) => ({ label: s.stage, share: s.count / peak, value: number.format(s.count), color: STAGE_HEX[s.stage] })),
        ),
      ),
    ),
  );
};
