import type { GameNeeds, Retest } from "../data";
import { code, count, day, header, join, link, stageLadder, table } from "../markdown";
import { openFunctions } from "../needs";
import type { Game } from "../resolve";
import { NOT_CONVERTING, STAGES, stageRank } from "../stages";
import { reach } from "../view";

/** Open functions named per game in the list; the game's own page has them all. */
const NEEDS_LISTED = 3;

/** What a game's newest blocker names that is still open, in a few words. */
function needsShort(needs: GameNeeds | undefined): string | null {
  if (!needs) return null;
  const open = openFunctions(needs);
  const parts = [
    open.length > 0 && `${open.slice(0, NEEDS_LISTED).map((f) => code(f.name)).join(", ")}${open.length > NEEDS_LISTED ? ` +${open.length - NEEDS_LISTED}` : ""}`,
    needs.errors.length > 0 && `${needs.errors.length} error${needs.errors.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

/** The compatibility list as Markdown: the ladder, how many games sit on each stage, and every game in one table. */
export function compatibilityText({ games, retest, needs, site }: { games: Game[]; retest: Map<string, Retest>; needs: Map<string, GameNeeds>; site: URL | undefined }): string {
  const reaches = games.map((g) => reach(g).stage);
  const tested = reaches.filter((r) => stageRank(r) >= 0).length;
  const counts = [
    ...STAGES.map((s) => [s.name, reaches.filter((r) => r === s.name).length]),
    [NOT_CONVERTING, reaches.filter((r) => r === NOT_CONVERTING).length],
    ["Untested", reaches.filter((r) => !r).length],
  ];
  const ordered = [...games].sort((a, b) => stageRank(reach(b).stage) - stageRank(reach(a).stage) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const ready = games.filter((g) => retest.get(g.slug)?.ready);
  const reports = (g: Game) => g.reports.length + g.uploads.length;

  return join([
    header(
      site,
      "AnyPS5 game compatibility",
      "/compatibility",
      `How far ${count(games.length)} PS5 games get on AnyPS5: ${count(tested)} have a stage and ${count(reaches.filter((r) => stageRank(r) >= stageRank("Ingame")).length)} reach gameplay, counting stages reached only with open pull requests; on main builds alone, ${count(games.filter((g) => stageRank(g.stage) >= 0).length)} and ${count(games.filter((g) => stageRank(g.stage) >= stageRank("Ingame")).length)}. Community test reports place every game on an eight-stage ladder, from converting to fully playable.`,
    ),
    "## The stages",
    "A game's stage is the furthest point any report reached on a `main` or release build. Stages reached only with open pull requests or local patches are listed separately.",
    stageLadder(),
    "## Games per stage",
    table(["Stage (counting open pull requests)", "Games"], counts),
    ready.length > 0 && "## Ready to retest",
    ready.length > 0 && "What stopped these games last time has been fixed since their newest report, and nothing they named is still open. A new run will show how much further they get.",
    ready.length > 0 && ready.map((g) => `- [${g.name}](${link(site, `/compatibility/${g.slug}.md`)})`).join("\n"),
    "## Every game",
    `Furthest stage first. Each game's page (the .md link) has where it stops, what it needs, results by release and every test report. Tracked games, run on every release: ${link(site, "/compatibility/tracked.md")}`,
    table(
      ["Game", "Title IDs", "Stage on main", "With open PRs", "Reports", "Last tested", "Still open in the newest blocker"],
      ordered.map((g) => {
        const { stage, onMain } = reach(g);
        const last = retest.get(g.slug)?.lastTested;
        return [
          `[${g.name}](${link(site, `/compatibility/${g.slug}.md`)})`,
          g.titleIds.join(", "),
          g.stage ?? "Untested",
          onMain ? null : stage,
          reports(g),
          last ? `${day(last)}${retest.get(g.slug)?.stale ? " (stale)" : ""}` : null,
          needsShort(needs.get(g.slug)),
        ];
      }),
    ),
  ]);
}
