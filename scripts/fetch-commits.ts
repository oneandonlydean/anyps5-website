/**
 * Counts the commits on upstream `main` per UTC day (by author date, merge commits included, the same total GitHub
 * shows) and writes data/generated/commits.json for the chart on /progress. Recounted from the clone each run.
 */
import { generated, writeJson } from "./lib/files";
import { commitsPerDay, syncUpstream } from "./lib/git";

await syncUpstream();
const days = await commitsPerDay();
await writeJson(generated("commits.json"), { synced: new Date().toISOString(), days });
console.log(`commits: ${days.reduce((n, d) => n + d.commits, 0)} over ${days.length} days`);
