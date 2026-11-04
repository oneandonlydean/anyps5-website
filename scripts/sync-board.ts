import { generated, readJson, writeJson } from "./lib/files";
import type { MergeBoard } from "../src/lib/upstream";

/**
 * Merge totals and the contributor boards from the bot's merge history (the Worker's GET /api/merges), for the
 * Discord bot's leaderboard and /stats pictures. A failed fetch keeps the previous data.
 */

const OUT = generated("merge-board.json");
const API = process.env.SITE_API ?? process.env.SITE_URL ?? "https://demo.anyps5.gg";

try {
  const res = await fetch(`${API.replace(/\/$/, "")}/api/merges`, { headers: { "user-agent": "anyps5-website" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as MergeBoard;
  const ok = data && typeof data.totals?.total === "number" && ["all", "month", "week"].every((p) => Array.isArray(data.boards?.[p as keyof MergeBoard["boards"]]));
  if (!ok) throw new Error("the response is not in the expected shape");
  await writeJson(OUT, data);
  console.log(`merge board: ${data.totals.total} merges by ${data.totals.people} people`);
} catch (error) {
  if (!(await readJson(OUT, null))) await writeJson(OUT, null);
  console.warn(`merge board: kept the previous data (${(error as Error).message})`);
}
