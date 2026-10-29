// Snapshots each game's stage, or compares two snapshots as the Markdown body of the sync pull request.
//   tsx scripts/stages.ts snapshot <file>
//   tsx scripts/stages.ts compare <before> <after>
import { readFile, writeFile } from "node:fs/promises";
import { getGames } from "../src/lib/data";
import { stageRank } from "../src/lib/stages";
import { reach } from "../src/lib/view";

type Snapshot = Record<string, { name: string; stage: string | null }>;

const [mode, ...files] = process.argv.slice(2);

if (mode === "snapshot") {
  const snapshot: Snapshot = {};
  for (const game of await getGames()) snapshot[game.slug] = { name: game.name, stage: reach(game).stage };
  await writeFile(files[0], JSON.stringify(snapshot));
} else if (mode === "compare") {
  const [before, after] = (await Promise.all(files.map(async (f) => JSON.parse(await readFile(f, "utf8"))))) as Snapshot[];
  const label = (stage: string | null) => stage ?? "untested";
  const added = Object.entries(after).filter(([slug]) => !before[slug]);
  const changed = Object.entries(after).filter(([slug, g]) => before[slug] && before[slug].stage !== g.stage);
  const lines = ["Automated sync of Game bring-up reports, title names, issue states and art.", ""];
  if (changed.length) {
    lines.push("### Stage changes", "", "| Game | Before | After |", "|---|---|---|");
    for (const [slug, g] of changed.sort(([, a], [, b]) => stageRank(b.stage as never) - stageRank(a.stage as never))) {
      const arrow = stageRank(g.stage as never) > stageRank(before[slug].stage as never) ? "↑" : "↓";
      lines.push(`| ${g.name} | ${label(before[slug].stage)} | ${arrow} ${label(g.stage)} |`);
    }
    lines.push("");
  }
  if (added.length) lines.push("### New games", "", ...added.map(([, g]) => `- ${g.name} (${label(g.stage)})`), "");
  if (!changed.length && !added.length) lines.push("No stage changes; reports, names or art were refreshed.");
  lines.push("", "Check stage drops and new names before merging. To override a result, add or edit `data/games/<slug>.yaml`.");
  console.log(lines.join("\n"));
} else {
  console.error("usage: stages.ts snapshot <file> | compare <before> <after>");
  process.exit(1);
}
