import { getLibraryHistory } from "../lib/upstream";

/** The site's record of per-library counts and milestones, which each data refresh starts from (see library-milestones.ts). */
export async function GET() {
  return new Response(JSON.stringify(await getLibraryHistory()), { headers: { "Content-Type": "application/json" } });
}
