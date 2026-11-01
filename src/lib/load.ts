import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { GameOverlay, TITLE_ID } from "./schema";

export const DATA = resolve(process.cwd(), "data");

export interface NamedOverlay extends GameOverlay {
  file: string;
}

export async function loadOverlays(): Promise<NamedOverlay[]> {
  const dir = resolve(DATA, "games");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort();
  return Promise.all(
    files.map(async (file) => {
      const result = GameOverlay.safeParse(parse(await readFile(resolve(dir, file), "utf8")));
      if (!result.success) throw new Error(`data/games/${file}: ${result.error.message}`);
      return { ...result.data, file };
    }),
  );
}

/** Reads data/generated/<name>; a fresh checkout without synced data falls back with a warning. */
export async function loadGenerated<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(resolve(DATA, "generated", name), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.warn(`data/generated/${name} is missing: run npm run sync`);
    return fallback;
  }
}

/** The title IDs in data/tracked.yaml, the games run on every release. */
export async function loadTracked(): Promise<string[]> {
  const data = parse(await readFile(resolve(DATA, "tracked.yaml"), "utf8")) as { games?: unknown };
  const ids = Array.isArray(data?.games) ? data.games : [];
  const bad = ids.filter((id) => typeof id !== "string" || !TITLE_ID.test(id));
  if (bad.length) throw new Error(`data/tracked.yaml: not title IDs: ${bad.join(", ")}`);
  return ids as string[];
}
