// Adds today's stage counts to the site's compatibility record (see src/lib/compat-history.ts). Runs after the other
// sync steps, since it counts the games as the site will show them.
import { getGames } from "../src/lib/data";
import { recordCompat, type CompatHistory } from "../src/lib/compat-history";
import { generated, writeJson } from "./lib/files";
import { readPublished } from "./lib/published";

const games = await getGames();
const history = recordCompat(await readPublished<CompatHistory>("compat-history.json"), new Date().toISOString().slice(0, 10), games.map((g) => g.stage));
await writeJson(generated("compat-history.json"), history);
console.log(`compatibility history: ${history.days.length} days recorded since ${history.days[0]!.date}`);
