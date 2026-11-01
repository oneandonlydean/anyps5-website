import { getCompatHistory } from "../lib/upstream";

/** The site's daily record of games per stage; each data refresh reads it back (scripts/record-compat.ts). */
export async function GET() {
  return Response.json(await getCompatHistory());
}
