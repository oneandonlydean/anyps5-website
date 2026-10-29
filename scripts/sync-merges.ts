import { generated, readJson, writeJson } from "./lib/files";
import { graphql, REPO } from "./lib/github";
import type { Merge } from "../src/lib/merges";

/**
 * Merged pull requests from the last 30 days, for the progress updates and feeds. Pull requests are read newest
 * update first; a run stops once it reaches ones updated before the previous run, so after the first run it reads
 * only a page or two. Upstream merges a few hundred a day, so older ones are dropped rather than kept forever.
 */

const OUT = generated("merges.json");
const KEEP_DAYS = 30;

interface Node {
  number: number;
  title: string;
  mergedAt: string;
  updatedAt: string;
  author: { login: string } | null;
  labels: { nodes: { name: string }[] };
}

const PAGE = `
  query($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: MERGED, first: 100, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { number title mergedAt updatedAt author { login } labels(first: 10) { nodes { name } } }
      }
    }
  }`;

async function main() {
  const previous = await readJson<{ synced: string | null; merges: Merge[] }>(OUT, { synced: null, merges: [] });
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  const since = previous.synced ?? cutoff;
  const known = new Map(previous.merges.map((m) => [m.number, m]));
  const started = new Date().toISOString();
  let after: string | null = null;
  let read = 0;

  pages: do {
    const data: { repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Node[] } } } = await graphql(PAGE, {
      ...REPO,
      after,
    });
    const { pageInfo, nodes } = data.repository.pullRequests;
    for (const node of nodes) {
      // Updated before the last run (or, on the first run, before the window): everything after this is known.
      if (node.updatedAt < since) break pages;
      read++;
      if (node.mergedAt < cutoff) continue;
      known.set(node.number, {
        number: node.number,
        title: node.title.trim(),
        mergedAt: node.mergedAt,
        author: node.author?.login ?? null,
        labels: node.labels.nodes.map((l) => l.name),
      });
    }
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (after);

  const merges = [...known.values()].filter((m) => m.mergedAt >= cutoff).sort((a, b) => b.mergedAt.localeCompare(a.mergedAt) || b.number - a.number);
  await writeJson(OUT, { synced: started, merges });
  console.log(`merges: ${merges.length} in the last ${KEEP_DAYS} days (${read} read)`);
}

await main();
