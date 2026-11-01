import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { commitIn, type BuildData } from "../src/lib/builds";
import { loadGenerated } from "../src/lib/load";
import type { Thread } from "../src/lib/schema";
import type { UploadExport } from "../src/lib/uploads";
import { generated, readJson, root, writeJson } from "./lib/files";
import { REPO, rest } from "./lib/github";

/**
 * Looks up the commits reports and uploads were built from, and the commit each release was cut from, so results can
 * be placed by release (src/lib/builds.ts). A commit never changes, so lookups are cached between runs; one upstream
 * doesn't have (a fork's, a typo) is asked about again after a week.
 */

type Found = { sha: string; date: string };
type Cached = { found: Found | null; checked: string };

const CACHE = resolve(root, "node_modules/.cache/anyps5-builds.json");
const RETRY_DAYS = 7;
/** At most this many new lookups per run, so a sudden pile of new hashes can't use up the API budget. */
const MAX_LOOKUPS = 200;

interface Commit {
  sha: string;
  commit: { committer: { date: string } };
}

async function lookUp(ref: string): Promise<Found | null> {
  try {
    const c = await rest<Commit>(`/repos/${REPO.owner}/${REPO.name}/commits/${encodeURIComponent(ref)}`);
    return { sha: c.sha, date: c.commit.committer.date };
  } catch (error) {
    // 404: no such commit; 422: a short hash that matches nothing or more than one commit.
    if (/ (404|422)$/.test((error as Error).message)) return null;
    throw error;
  }
}

async function main() {
  const [threads, uploads] = await Promise.all([loadGenerated<Thread[]>("threads.json", []), loadGenerated<UploadExport>("uploads.json", { generated: null, uploads: [], hidden: { screenshots: [], art: [] } })]);
  const cache = await readJson<Record<string, Cached>>(CACHE, {});
  const now = new Date().toISOString();
  const stale = (c: Cached | undefined) => !c || (!c.found && Date.parse(now) - Date.parse(c.checked) > RETRY_DAYS * 864e5);

  const releases = (await rest<{ tag_name: string; published_at: string; draft: boolean }[]>(`/repos/${REPO.owner}/${REPO.name}/releases?per_page=30`)).filter((r) => !r.draft);
  const wanted = [
    ...new Set([
      ...threads.flatMap((t) => t.reports.map((r) => commitIn(r.build))),
      ...uploads.uploads.map((u) => u.commit?.toLowerCase() ?? null),
    ]),
  ].filter((h): h is string => Boolean(h));

  let lookups = 0;
  for (const ref of [...releases.map((r) => `tag:${r.tag_name}`), ...wanted]) {
    if (!stale(cache[ref])) continue;
    if (lookups++ >= MAX_LOOKUPS) break;
    cache[ref] = { found: await lookUp(ref.replace(/^tag:/, "")), checked: now };
  }
  await mkdir(resolve(root, "node_modules/.cache"), { recursive: true });
  await writeJson(CACHE, cache);

  const data: BuildData = {
    releases: releases.flatMap((r) => {
      const found = cache[`tag:${r.tag_name}`]?.found;
      return found ? [{ tag: r.tag_name, sha: found.sha, date: found.date, published: r.published_at }] : [];
    }),
    commits: Object.fromEntries(wanted.filter((h) => cache[h]).map((h) => [h, cache[h]!.found])),
  };
  await writeJson(generated("builds.json"), data);
  const known = Object.values(data.commits).filter(Boolean).length;
  console.log(`builds: ${known} of ${wanted.length} commits found upstream, ${data.releases.length} releases, ${lookups} lookups`);
}

await main();
