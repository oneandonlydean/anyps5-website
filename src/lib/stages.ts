export const STAGES = [
  { name: "Converts", short: "Converts", meaning: "The package unpacks and the relinker converts the executable." },
  { name: "Loads", short: "Loads", meaning: "The executable loads and reaches the game's entry point." },
  { name: "Starts", short: "Starts", meaning: "Game code runs past startup." },
  { name: "First draw", short: "Draws", meaning: "The first GPU draw or dispatch executes." },
  { name: "Presents", short: "Presents", meaning: "Logos, video or loading screens." },
  { name: "Menus", short: "Menus", meaning: "A menu or title screen that responds." },
  { name: "Ingame", short: "Ingame", meaning: "Into gameplay." },
  { name: "Playable", short: "Playable", meaning: "Played it start to finish." },
] as const;

export type StageName = (typeof STAGES)[number]["name"];

export const STAGE_NAMES = STAGES.map((s) => s.name) as unknown as readonly [StageName, ...StageName[]];

export const NOT_CONVERTING = "Not converting" as const;

export type StageOrNone = StageName | typeof NOT_CONVERTING;

export function stageRank(stage: StageOrNone | null | undefined): number {
  if (!stage || stage === NOT_CONVERTING) return -1;
  return STAGE_NAMES.indexOf(stage);
}

export function stageSlug(stage: StageOrNone | null | undefined): string {
  if (!stage) return "untested";
  if (stage === NOT_CONVERTING) return "none";
  return stage.toLowerCase().replace(/\s+/g, "-");
}

export function isStage(value: unknown): value is StageName {
  return typeof value === "string" && (STAGE_NAMES as readonly string[]).includes(value);
}

export function maxStage<T extends StageOrNone | null | undefined>(a: T, b: T): T {
  return stageRank(a) >= stageRank(b) ? a : b;
}

/**
 * Stage colours as hex, for images drawn outside the page (link previews, badges) where CSS variables cannot reach.
 * The same values as the dark theme's --stage-* tokens in global.css.
 */
export const STAGE_HEX: Record<StageName | "Not converting" | "Untested", string> = {
  Converts: "#f0506e",
  Loads: "#f77b3e",
  Starts: "#f6a23a",
  "First draw": "#f2cc3d",
  Presents: "#b5e04a",
  Menus: "#5bd977",
  Ingame: "#2fcfa6",
  Playable: "#3cc8f0",
  "Not converting": "#6b7385",
  Untested: "#5d6679",
};
