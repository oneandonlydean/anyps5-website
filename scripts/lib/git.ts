import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { root } from "./files";

const run = promisify(execFile);

const UPSTREAM_GIT = "https://github.com/boykopovar/AnyPS5.git";
export const UPSTREAM_CLONE = resolve(root, "node_modules/.cache/anyps5-upstream");

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", UPSTREAM_CLONE, ...args], { maxBuffer: 256 << 20 });
  return stdout;
}

/**
 * Brings a blobless clone of upstream `main` up to date. Only commits and trees come down up front; file contents
 * are fetched on demand when they are first read, so measuring many days of history stays cheap.
 */
export async function syncUpstream(): Promise<void> {
  const exists = await access(resolve(UPSTREAM_CLONE, "HEAD")).then(
    () => true,
    () => false,
  );
  if (!exists) {
    await run("git", ["clone", "--bare", "--filter=blob:none", "--single-branch", "--branch", "main", UPSTREAM_GIT, UPSTREAM_CLONE], { maxBuffer: 64 << 20 });
  } else {
    await git("fetch", "--filter=blob:none", "origin", "+refs/heads/main:refs/heads/main");
  }
}

export interface DayCommit {
  date: string;
  commit: string;
}

/** The last first-parent commit of `main` on each UTC day, oldest first. */
export async function dailyCommits(): Promise<DayCommit[]> {
  const log = await git("log", "--first-parent", "--format=%H %cI", "main");
  const days = new Map<string, string>();
  for (const line of log.trim().split("\n").reverse()) {
    const [commit, iso] = line.split(" ");
    days.set(new Date(iso).toISOString().slice(0, 10), commit);
  }
  return [...days].map(([date, commit]) => ({ date, commit }));
}

export async function headCommit(): Promise<DayCommit> {
  const [commit, iso] = (await git("log", "-1", "--format=%H %cI", "main")).trim().split(" ");
  return { commit, date: new Date(iso).toISOString().slice(0, 10) };
}

interface Entry {
  object: string;
  path: string;
}

/** The C and C++ sources under the given directories at a commit. Missing directories are skipped. */
export async function listTree(commit: string, directories: string[]): Promise<Entry[]> {
  const listing = await git("ls-tree", "-r", "--format=%(objectname) %(path)", commit, "--", ...directories);
  return listing
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(" ");
      return { object: line.slice(0, space), path: line.slice(space + 1) };
    })
    .filter((e) => /\.(c|cc|cpp|h|hpp|inl)$/.test(e.path));
}

/** Runs `git cat-file` with the object IDs on stdin and returns its raw output. */
function catFile(mode: "--batch" | "--batch-check", objects: string[], env?: NodeJS.ProcessEnv): Promise<Buffer> {
  const child = spawn("git", ["-C", UPSTREAM_CLONE, "cat-file", mode], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, ...env } });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((ok, fail) =>
    child.on("close", (code) => (code === 0 ? ok(Buffer.concat(chunks)) : fail(new Error(`git cat-file exited with ${code}`)))),
  );
  child.stdin.end(objects.join("\n") + "\n");
  return done;
}

/**
 * Downloads the blobs the blobless clone does not have yet in a few large requests. Without this, git fetches each
 * missing blob on its own round trip the first time it is read.
 */
export async function prefetch(objects: string[]): Promise<void> {
  const unique = [...new Set(objects)];
  if (unique.length === 0) return;
  const check = (await catFile("--batch-check", unique, { GIT_NO_LAZY_FETCH: "1" })).toString();
  const missing = check
    .split("\n")
    .filter((line) => line.endsWith(" missing"))
    .map((line) => line.split(" ")[0]);
  for (let i = 0; i < missing.length; i += 2000) {
    await git("-c", "fetch.negotiationAlgorithm=noop", "fetch", "--no-tags", "--no-write-fetch-head", "--filter=blob:none", "origin", ...missing.slice(i, i + 2000));
  }
}

/** Reads every C and C++ source under the given directories at a commit, keyed by repository path. */
export async function readTree(commit: string, directories: string[]): Promise<Map<string, string>> {
  const entries = await listTree(commit, directories);
  const files = new Map<string, string>();
  if (entries.length === 0) return files;
  await prefetch(entries.map((e) => e.object));

  // One `cat-file --batch` process streams every blob, instead of one git process per file.
  const output = await catFile("--batch", entries.map((e) => e.object));
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = output.indexOf(10, offset);
    const [, type, size] = output.subarray(offset, headerEnd).toString().split(" ");
    if (type !== "blob") throw new Error(`Unexpected object for ${entry.path}: ${type}`);
    const start = headerEnd + 1;
    files.set(entry.path, output.subarray(start, start + Number(size)).toString("utf8"));
    offset = start + Number(size) + 1;
  }
  return files;
}
