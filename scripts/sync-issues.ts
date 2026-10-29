import { generated, writeJson } from "./lib/files";
import { graphql, REPO } from "./lib/github";
import { loadGenerated, loadOverlays } from "../src/lib/load";
import type { Issue, Thread } from "../src/lib/schema";

const BATCH = 50;

interface Node {
  __typename: "Issue" | "PullRequest";
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
}

async function main() {
  const threads = await loadGenerated<Thread[]>("threads.json", []);
  const overlays = await loadOverlays();
  const numbers = [
    ...new Set([
      ...threads.flatMap((t) => t.reports.flatMap((r) => [...r.blockers, ...r.prs])),
      ...overlays.flatMap((o) => o.curated?.blockers ?? []),
    ]),
  ].sort((a, b) => a - b);

  const issues: Record<number, Issue> = {};
  for (let i = 0; i < numbers.length; i += BATCH) {
    const batch = numbers.slice(i, i + BATCH);
    const fields = batch
      .map((n) => `n${n}: issueOrPullRequest(number: ${n}) { __typename ... on Issue { number title url state } ... on PullRequest { number title url state } }`)
      .join("\n");
    const data = await graphql<{ repository: Record<string, Node | null> }>(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
      REPO,
      true,
    );
    for (const node of Object.values(data.repository)) {
      if (!node) continue;
      issues[node.number] = {
        number: node.number,
        kind: node.__typename === "PullRequest" ? "pr" : "issue",
        title: node.title,
        state: node.state.toLowerCase() as Issue["state"],
        url: node.url,
      };
    }
  }

  await writeJson(generated("issues.json"), issues);
  const open = Object.values(issues).filter((i) => i.state === "open").length;
  console.log(`issues: ${Object.keys(issues).length} of ${numbers.length} references resolved, ${open} open`);
}

await main();
