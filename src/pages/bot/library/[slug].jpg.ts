import type { APIRoute } from "astro";
import { getNeeds } from "../../../lib/data";
import { librarySlug } from "../../../lib/library-slug";
import { openFunctions, tallyWanted } from "../../../lib/needs";
import { libraryImage } from "../../../lib/og";
import { getLibraryHistory, getProgress } from "../../../lib/upstream";

/** One picture per system library, for the Discord bot's /library. Only libraries that changed are redrawn. */

const MILESTONE = { started: "First function", half: "Reached half", complete: "Completed" } as const;
const RECENT_DAYS = 14;

export async function getStaticPaths() {
  const progress = await getProgress();
  return (progress?.libraries.groups ?? []).filter((g) => g.total > 0).map((g) => ({ params: { slug: librarySlug(g.label) }, props: { name: g.label } }));
}

export const GET: APIRoute = async ({ props }) => {
  const name = (props as { name: string }).name;
  const [progress, history, needs] = await Promise.all([getProgress(), getLibraryHistory(), getNeeds()]);
  const group = progress!.libraries.groups.find((g) => g.label === name)!;
  const now = history?.latest.libraries[name];
  const before = history?.previous?.libraries[name];
  const recent = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
  const milestone = history?.milestones.filter((m) => m.library === name && m.date >= recent).at(-1);
  const wanted = tallyWanted(needs, openFunctions, (f) => f.name)
    .filter(({ item }) => item.library === name)
    .map(({ item, games }) => ({ name: item.name, games: games.length }));
  return libraryImage({
    name,
    done: group.done,
    total: group.total,
    gained: now && before ? now[0] - before[0] : null,
    milestone: milestone ? `${MILESTONE[milestone.kind]} ${new Date(`${milestone.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : null,
    wanted,
  });
};
