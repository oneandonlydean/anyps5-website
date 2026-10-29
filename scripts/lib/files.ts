import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const root = process.cwd();
export const generated = (name: string) => resolve(root, "data/generated", name);

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Writes through a temporary file, so a run killed mid-write never leaves a truncated file that reads as empty. */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n");
  await rename(`${path}.tmp`, path);
}
