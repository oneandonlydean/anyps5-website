import { generated, readJson } from "./files";

/** The deployed site this build reads its own records back from. */
export const siteUrl = () => process.env.SITE_API ?? process.env.SITE_URL ?? "https://demo.anyps5.gg";

/**
 * A record the site keeps for itself (library milestones, compatibility history). CI keeps nothing between runs, so the
 * record lives on the deployed site: the published copy is read back and wins unless the local one is newer. A site
 * that has never published it (404) starts the record over; any other failure stops the refresh, rather than starting
 * over and losing what was recorded.
 */
export async function readPublished<T extends { latest: { date: string } }>(name: string): Promise<T | null> {
  const local = await readJson<T | null>(generated(name), null);
  const response = await fetch(new URL(`/${name}`, siteUrl()));
  if (response.ok) {
    const published = (await response.json()) as T | null;
    if (published && (!local || published.latest.date >= local.latest.date)) return published;
  } else if (response.status !== 404) {
    throw new Error(`${name}: ${siteUrl()} answered ${response.status}`);
  }
  return local;
}
