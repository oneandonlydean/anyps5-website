// Checks data/games/*.yaml beyond the schema that loadOverlays already enforces, data/tracked.yaml and data/bot.yaml.
import { loadBotText, loadGenerated, loadOverlays, loadTracked } from "../src/lib/load";
import type { Thread } from "../src/lib/schema";

const overlays = await loadOverlays();
const problems: string[] = [];
const owners = new Map<string, string>();
const today = new Date().toISOString().slice(0, 10);

for (const overlay of overlays) {
  const where = `data/games/${overlay.file}`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*\.yaml$/.test(overlay.file)) problems.push(`${where}: file names are lowercase words joined by hyphens`);
  for (const id of overlay.title_ids) {
    const owner = owners.get(id);
    if (owner) problems.push(`${where}: ${id} is already in data/games/${owner}`);
    else owners.set(id, overlay.file);
  }
  if (overlay.curated && overlay.curated.date > today) problems.push(`${where}: curated.date ${overlay.curated.date} is in the future`);
  for (const [role, url] of Object.entries(overlay.art ?? {})) {
    if (url && !url.startsWith("https://")) problems.push(`${where}: art.${role} must be an https URL`);
  }
}

const tracked = await loadTracked();
for (const id of new Set(tracked.filter((id, i) => tracked.indexOf(id) !== i))) problems.push(`data/tracked.yaml: ${id} is listed twice`);
// A tracked game whose thread is gone only drops off the page, so it is a warning rather than a failed check.
const known = new Set([...(await loadGenerated<Thread[]>("threads.json", [])).flatMap((t) => t.titleIds), ...overlays.flatMap((o) => o.title_ids)]);
const unknown = tracked.filter((id) => !known.has(id));
if (known.size && unknown.length) console.warn(`data/tracked.yaml: no game has ${unknown.join(", ")}`);

// Throws on anything wrong with it.
const bot = await loadBotText();

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${overlays.length} game files, ${tracked.length} tracked games and ${bot.answers.length} bot answers valid`);
