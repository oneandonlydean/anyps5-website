import { DOCS } from "../docs";
import { count, day, join, link, percent } from "../markdown";
import type { Game } from "../resolve";
import { DISCORD_URL, DISCUSSIONS_URL, REPO_URL, BUILT_AT } from "../site";
import { STAGES, stageRank, type StageName } from "../stages";
import type { Coverage, ProgressPart, Release } from "../upstream";
import { reach } from "../view";

export interface LlmsInput {
  release: Release | null;
  progress: { libraries: ProgressPart } | null;
  coverage: Coverage | null;
  games: Game[];
  steps: { slug: string; title: string; summary: string }[];
  site: URL | undefined;
}

/**
 * /llms.txt (https://llmstxt.org): what AnyPS5 is, where it stands today, and a link to the Markdown copy of every page,
 * so an AI tool can read the site without the charts and scripts.
 */
export function llmsText({ release, progress, coverage, games, steps, site }: LlmsInput): string {
  const md = (path: string) => link(site, `${path}.md`);
  // The main-build stage, as the progress page counts; the compatibility list's headline also counts open pull requests.
  const atLeast = (stage: StageName, withPrs = false) => games.filter((g) => stageRank(withPrs ? reach(g).stage : g.stage) >= stageRank(stage)).length;
  const libraries = progress?.libraries;

  return join([
    "# AnyPS5",
    "> AnyPS5 rewrites a PS5 game's executable to run natively on Linux or Windows, using rebuilt PS5 system libraries and a shader recompiler to Vulkan. No emulator in between. This site tracks how far games get, what is still missing, and how to set it up.",
    `These are plain Markdown copies of the site's pages, generated from the same data on every rebuild (this one: ${BUILT_AT.toISOString().slice(0, 16).replace("T", " ")} UTC). Every game has its own page, at ${link(site, "/compatibility")}/ followed by the game's slug and ".md", linked from the compatibility page. Upstream source: ${REPO_URL}`,
    "## Current state",
    [
      release && `- Latest release: ${release.tag}, published ${day(release.published)}`,
      libraries && `- System libraries: ${percent(libraries.done, libraries.total)} of declared functions implemented (${count(libraries.done)} of ${count(libraries.total)})`,
      coverage &&
        `- Shader recompiler: ${percent(coverage.instructions.decoded, coverage.instructions.total)} of ${coverage.isa} instruction forms decode; ${coverage.throws.total} unsupported cases left`,
      `- Games: ${count(games.length)} on the list. On main builds, ${count(atLeast("Converts"))} have a stage, ${count(atLeast("Presents"))} present frames, ${count(atLeast("Ingame"))} reach gameplay and ${count(atLeast("Playable"))} are playable. Counting stages reached only with open pull requests or local patches, ${count(atLeast("Converts", true))} have a stage and ${count(atLeast("Ingame", true))} reach gameplay.`,
      `- Stages, lowest to highest: ${STAGES.map((s) => s.name).join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
    "## Project state",
    [
      `- [Progress](${md("/progress")}): system libraries, the shader recompiler, development pace, and **what games are waiting on**: the missing functions and errors named in games' newest reports, ranked by how many games they block`,
      `- [Game compatibility](${md("/compatibility")}): every game's stage, last test and what blocks it, with links to each game's page`,
      `- [Tracked games](${md("/compatibility/tracked")}): a fixed set of games run on every release, to spot regressions`,
      `- [Updates](${md("/updates")}): the last 30 days of releases, stage rises, regressions and merges`,
      `- [Download](${md("/download")}): the latest release's files`,
    ].join("\n"),
    "## Docs",
    [
      ...steps.map((s) => `- [${s.title}](${md(`/docs/guide/${s.slug}`)}): ${s.summary}`),
      ...DOCS.map((d) => `- [${d.title}](${md(`/docs/${d.slug}`)}): ${d.summary}`),
      `- [FAQ](${md("/faq")}): short answers to common questions`,
    ].join("\n"),
    "## Optional",
    [
      `- [Web converter](${link(site, "/convert")}): converts a game in the browser; an interactive page with no text version`,
      `- [Upload a run report](${link(site, "/report")}): sign in with GitHub and upload anyps5-report.json after a run`,
      `- [Game bring-up discussions](${DISCUSSIONS_URL}): where testers post reports`,
      `- [Discord](${DISCORD_URL})`,
      `- [Feeds](${link(site, "/feeds")}): Atom feeds of updates, releases, merges and games`,
      `- [Function lookup](${link(site, "/bot/lookup.json")}): JSON of every system library function with whether it is implemented, every error the source raises and where, and which games name each`,
      `- [Games per stage over time](${link(site, "/compat-history.json")}) and [library functions over time](${link(site, "/library-history.json")}): JSON`,
    ].join("\n"),
  ]);
}
