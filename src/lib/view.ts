import { QUALIFYING, type Game } from "./resolve";
import { stageRank, type StageOrNone } from "./stages";

/** How far a game gets, and whether that holds on `main` or needs open pull requests. */
export function reach(game: Pick<Game, "stage" | "branchStage">): { stage: StageOrNone | null; onMain: boolean } {
  if (game.branchStage && stageRank(game.branchStage) > stageRank(game.stage)) return { stage: game.branchStage, onMain: false };
  return { stage: game.stage, onMain: true };
}

const SONY_CDN = /^https:\/\/image\.api\.playstation\.com\//;

export function artSrc(url: string, width: number): string {
  return SONY_CDN.test(url) ? `${url}?w=${width}` : url;
}

export function artSrcset(url: string, widths: number[]): string | undefined {
  return SONY_CDN.test(url) ? widths.map((w) => `${url}?w=${w} ${w}w`).join(", ") : undefined;
}

/** A stable hue from a string, for art placeholders. */
export function hue(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export const PLATFORM_LABEL = { linux: "Linux", windows: "Windows", macos: "macOS" } as const;

/**
 * The best stage a game reaches on each system it was tested on, as "os:gpu:rank" tokens for the compatibility filters,
 * e.g. "linux:amd:6 windows:nvidia:5". Unknown parts are "any". Curated per-platform stages count with any GPU.
 * `mainOnly` keeps only reports from builds that set the headline stage.
 */
export function systemTokens(game: Pick<Game, "reports" | "platforms">, mainOnly: boolean): string {
  const best = new Map<string, number>();
  const add = (key: string, rank: number) => best.set(key, Math.max(best.get(key) ?? -1, rank));
  for (const r of game.reports) {
    if (!r.stage || (mainOnly && !QUALIFYING.has(r.buildKind))) continue;
    add(`${r.platform ?? "any"}:${(r.gpuVendor ?? "any").toLowerCase()}`, stageRank(r.stage));
  }
  for (const [platform, stage] of Object.entries(game.platforms)) add(`${platform}:any`, stageRank(stage));
  return [...best].map(([key, rank]) => `${key}:${rank}`).join(" ");
}
