import { buildLabel, lowerThan, type BuildData, type Tested } from "../builds";
import type { Retest } from "../data";
import { day, header, join, link, table } from "../markdown";
import type { Game } from "../resolve";
import { stageRank } from "../stages";

/** Releases shown as columns, newest first, as on the page. */
const COLUMNS = 4;

/** The tracked games as Markdown: the same games on every release, with what slipped back and what is still to run. */
export function trackedText({ games, builds, tested, retest, site }: { games: Game[]; builds: BuildData; tested: Map<string, Tested>; retest: Map<string, Retest>; site: URL | undefined }): string {
  const releases = builds.releases.slice(0, COLUMNS).map((r) => r.tag);
  const rows = games.map((game) => {
    const results = tested.get(game.slug)!.releases;
    const cells = releases.map((tag) => results.find((r) => r.release === tag) ?? null);
    const lower = cells.map((cell) => Boolean(cell && lowerThan(results, results.indexOf(cell))));
    return { game, cells, lower, retest: retest.get(game.slug)! };
  });
  const totals = releases.map((tag, i) => ({
    tag,
    tested: rows.filter((r) => r.cells[i]).length,
    ingame: rows.filter((r) => r.cells[i] && stageRank(r.cells[i]!.stage) >= stageRank("Ingame")).length,
  }));
  const wanted = rows
    .filter((r) => !r.cells[0])
    .sort((a, b) => Number(b.retest.ready) - Number(a.retest.ready) || (a.retest.lastTested ?? "").localeCompare(b.retest.lastTested ?? ""));

  return join([
    header(
      site,
      "Tracked games: the same games, every release",
      "/compatibility/tracked",
      `These ${games.length} games, chosen by maintainers, are run again on every release, to show whether AnyPS5 is gaining ground and to catch anything that slips back.`,
    ),
    totals.length > 0 && totals.map((t) => `- ${t.tag}: ${t.ingame} of ${games.length} in game; ${t.tested} of ${games.length} run on it`).join("\n"),
    "## By release",
    table(
      ["Game", ...releases],
      rows.map((r) => [
        `[${r.game.name}](${link(site, `/compatibility/${r.game.slug}.md`)})`,
        ...r.cells.map((cell, i) => (cell ? `${cell.stage}${cell.approximate ? " (by date)" : ""}${r.lower[i] ? " ↓ lower than an earlier release" : ""}` : null)),
      ]),
    ),
    'Each cell is the furthest stage reported on that release or on main before the next one, from Discussions reports and uploaded run reports, placed by the commit they were built from. "By date" cells name no commit and are placed by date. "Lower than an earlier release" is a regression, or a different setup. "—" means no result on that release.',
    wanted.length > 0 && releases[0] && `## Not run on ${releases[0]} yet`,
    wanted.length > 0 &&
      wanted
        .map(
          (r) =>
            `- [${r.game.name}](${link(site, `/compatibility/${r.game.slug}.md`)}): ${r.retest.ready ? "what stopped it has been fixed since; " : ""}${r.retest.lastTested ? `last result ${day(r.retest.lastTested)}${r.retest.lastBuild ? ` on ${buildLabel(r.retest.lastBuild, builds.releases.at(-1)?.tag)}${r.retest.lastBuild.basis === "date" ? " (placed by date)" : ""}` : ""}` : "no results yet"}`,
        )
        .join("\n"),
  ]);
}
