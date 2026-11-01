import { generated, writeJson } from "./lib/files";
import { loadGenerated, loadOverlays } from "../src/lib/load";
import type { Thread, Title } from "../src/lib/schema";
import type { UploadExport } from "../src/lib/uploads";

const LISTS = ["PS5", "PS4"].map((p) => `https://raw.githubusercontent.com/andshrew/PlayStation-Titles/main/${p}_Titles.tsv`);

async function main() {
  const threads = await loadGenerated<Thread[]>("threads.json", []);
  // Uploaded runs too, so a game first reported by an upload gets its store name (see groupGames).
  const uploads = (await loadGenerated<UploadExport | null>("uploads.json", null))?.uploads ?? [];
  const wanted = new Set([...threads.flatMap((t) => t.titleIds), ...(await loadOverlays()).flatMap((o) => o.title_ids), ...uploads.map((u) => u.titleId)]);
  const titles: Record<string, Title> = {};

  for (const url of LISTS) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const [, ...rows] = (await response.text()).split("\n");
    for (const row of rows) {
      const [titleId, concept, name, , region] = row.split("\t");
      const id = titleId?.slice(0, 9);
      if (!id || !name || !wanted.has(id) || titles[id]) continue;
      titles[id] = { name: name.trim(), region: region?.trim() || null, concept: concept?.trim() || null };
    }
  }

  await writeJson(generated("titles.json"), Object.fromEntries(Object.entries(titles).sort()));
  console.log(`titles: ${Object.keys(titles).length} of ${wanted.size} title IDs listed by the PlayStation Store`);
}

await main();
