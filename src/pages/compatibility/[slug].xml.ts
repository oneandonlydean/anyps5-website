import type { APIContext } from "astro";
import { atomFeed, type AtomEntry } from "../../lib/atom";
import { getGames } from "../../lib/data";
import type { Game } from "../../lib/resolve";
import { PLATFORM_LABEL } from "../../lib/view";

export async function getStaticPaths() {
  return (await getGames()).map((game) => ({ params: { slug: game.slug }, props: { game } }));
}

/** The start of what a tester wrote, for a feed entry's summary; the report itself has the rest. */
const short = (text: string) => (text.length > 280 ? text.slice(0, 279).trimEnd() + "…" : text).replace(/\n+/g, " ");

/** A feed for one game: every stage it reaches and every new test report, for people following that game. */
export function GET({ site, props }: APIContext) {
  const game = (props as { game: Game }).game;
  const page = `/compatibility/${game.slug}`;
  const stages: AtomEntry[] = game.timeline.map((event, i) => ({
    id: `${page}#stage-${event.stage}`,
    title: i === 0 ? `${game.name}: first tested, ${event.stage}` : `${game.name} reaches ${event.stage}`,
    url: event.url ?? page,
    date: event.date,
    summary: i === 0 ? `The first report puts ${game.name} at ${event.stage}.` : `Up from ${game.timeline[i - 1].stage}.`,
    category: "stage",
  }));
  const reports: AtomEntry[] = game.reports.map((r) => {
    const system = [r.platform && PLATFORM_LABEL[r.platform], r.gpu ?? r.gpuVendor].filter(Boolean).join(", ");
    return {
      id: r.url,
      title: `New report: ${r.stage ?? "no stage"}${system ? ` on ${system}` : ""}`,
      url: r.url,
      date: r.date,
      summary: [r.author && `By ${r.author}.`, r.shown && short(r.shown)].filter(Boolean).join(" ") || `A new test report for ${game.name}.`,
      category: "report",
    };
  });
  return atomFeed({
    site,
    path: `${page}.xml`,
    page,
    title: `${game.name} on AnyPS5`,
    subtitle: `Stage changes and test reports for ${game.name}.`,
    entries: [...stages, ...reports].sort((a, b) => b.date.localeCompare(a.date)),
  });
}
