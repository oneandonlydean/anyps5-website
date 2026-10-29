// Writes SQL that loads every merged PR on the repo into the merges table.
// Safe to re-run: rows are replaced by PR number.
// Usage: GITHUB_TOKEN=... GITHUB_REPO=owner/repo node scripts/backfill-merges.mjs out.sql
//        npx wrangler d1 execute DB --remote --file out.sql
import { writeFileSync } from "node:fs";

const { GITHUB_TOKEN, GITHUB_REPO } = process.env;
const out = process.argv[2];
if (!GITHUB_TOKEN || !GITHUB_REPO || !out) {
  console.error("Set GITHUB_TOKEN and GITHUB_REPO, and pass an output file");
  process.exit(1);
}

const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;
const lines = [];
for (let page = 1; ; page++) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/pulls?state=closed&sort=created&direction=asc&per_page=100&page=${page}`,
    { headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "gh-discord-roles" } },
  );
  if (!res.ok) {
    console.error(`GitHub returned ${res.status} on page ${page}`);
    process.exit(1);
  }
  const pulls = await res.json();
  for (const pr of pulls) {
    if (!pr.merged_at) continue;
    lines.push(
      `INSERT OR REPLACE INTO merges (number, title, author_id, author_login, merged_at) VALUES (${pr.number}, ${quote(pr.title)}, ${pr.user?.id ?? "NULL"}, ${quote(pr.user?.login ?? "ghost")}, ${quote(pr.merged_at)});`,
    );
  }
  if (pulls.length < 100) break;
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${lines.length} merged PRs written to ${out}`);
