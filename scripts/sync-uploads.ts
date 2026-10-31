import { generated, readJson, writeJson } from "./lib/files";
import type { UploadExport } from "../src/lib/uploads";

/**
 * Uploaded run reports and what maintainers hid, from the site Worker's public export. A failed fetch keeps the
 * previous data, so an outage never empties the site.
 */

const OUT = generated("uploads.json");
const API = process.env.SITE_API ?? process.env.SITE_URL ?? "https://demo.anyps5.gg";

async function main() {
  const previous = await readJson<UploadExport | null>(OUT, null);
  try {
    const res = await fetch(`${API.replace(/\/$/, "")}/api/export`, { headers: { "user-agent": "anyps5-website" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = (await res.json()) as UploadExport;
    // Only a well-formed export replaces the data the build reads; anything else (an error body, a proxy page) is ignored.
    const ok =
      data && Array.isArray(data.uploads) && data.hidden && Array.isArray(data.hidden.screenshots) && Array.isArray(data.hidden.art) && data.uploads.every((u) => typeof u?.titleId === "string" && typeof u?.githubId === "number");
    if (!ok) throw new Error("the export is not in the expected shape");
    await writeJson(OUT, data);
    console.log(`uploads: ${data.uploads.length} visible, ${data.hidden.screenshots.length} screenshots and ${data.hidden.art.length} art hidden`);
  } catch (error) {
    if (!previous) await writeJson(OUT, { generated: null, uploads: [], hidden: { screenshots: [], art: [] } } satisfies UploadExport);
    console.warn(`uploads: kept the previous data (${(error as Error).message})`);
  }
}

await main();
