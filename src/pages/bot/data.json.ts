import { botData } from "../../lib/bot-data";

/** The Discord bot's data file (src/lib/bot-data.ts), read by the Worker from the site's own assets. */
export async function GET() {
  return new Response(JSON.stringify(await botData()), { headers: { "Content-Type": "application/json" } });
}
