// Checks data/games/*.yaml beyond the schema that loadOverlays already enforces.
import { loadOverlays } from "../src/lib/load";

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

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${overlays.length} game files valid`);
