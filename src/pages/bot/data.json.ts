import { strings } from "../../i18n";
import { buildLabel } from "../../lib/builds";
import { getBuilds, getGames, getNeeds, getRetest, getTested, getTrackedGames } from "../../lib/data";
import { loadBotText } from "../../lib/load";
import { openFunctions, tallyWanted } from "../../lib/needs";
import { newReportUrl } from "../../lib/site";
import { stageRank } from "../../lib/stages";
import { getCoverage, getProgress, getRelease } from "../../lib/upstream";
import { artSrc } from "../../lib/view";

/**
 * Everything the Discord bot answers commands from, in one file it reads from the site's own assets: games, library and
 * shader coverage, what games wait on, the release, the tracked games, the FAQ and data/bot.yaml. Links are paths on
 * the site; the bot adds its domain.
 */

const BLOCKERS_SHOWN = 3;
const WANTED_SHOWN = 15;

/** The FAQ's HTML answers as Discord markdown. */
const markdown = (html: string) =>
  html
    .replace(/<a href="([^"]+)">(.*?)<\/a>/g, "[$2]($1)")
    .replace(/<\/?(b|strong)>/g, "**")
    .replace(/<\/?code>/g, "`")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]!);

export async function GET() {
  const [games, builds, tested, retest, trackedGames, needs, progress, coverage, release, text] = await Promise.all([
    getGames(),
    getBuilds(),
    getTested(),
    getRetest(),
    getTrackedGames(),
    getNeeds(),
    getProgress(),
    getCoverage(),
    getRelease(),
    loadBotText(),
  ]);
  const firstRelease = builds.releases.at(-1)?.tag;
  const latest = builds.releases[0]?.tag;
  const name = new Map(games.map((g) => [g.slug, g.name]));
  const asset = (pattern: RegExp) => {
    const found = release?.assets.find((a) => pattern.test(a.name));
    return found ? { name: found.name, url: found.url, size: found.size } : null;
  };

  const data = {
    generated: new Date().toISOString(),
    games: games.map((g) => {
      const last = retest.get(g.slug)!;
      return {
        slug: g.slug,
        name: g.name,
        ids: g.titleIds,
        stage: g.stage,
        cover: g.art?.cover ? artSrc(g.art.cover, 240) : null,
        tested: last.lastTested ? { date: last.lastTested, build: last.lastBuild ? buildLabel(last.lastBuild, firstRelease) : null, releasesSince: last.releasesSince } : null,
        blockers: g.blockers.slice(0, BLOCKERS_SHOWN).map((b) => ({ number: b.number, kind: b.kind, title: b.title, url: b.url })),
        thread: g.threads[0]?.url ?? newReportUrl(`${g.name} (${g.titleIds[0]})`),
      };
    }),
    libraries: progress && {
      done: progress.libraries.done,
      total: progress.libraries.total,
      groups: progress.libraries.groups.map((l) => ({ name: l.label, done: l.done, total: l.total })),
    },
    shaders: coverage && { decoded: coverage.instructions.decoded, translated: coverage.instructions.translated, total: coverage.instructions.total },
    wanted: tallyWanted(needs, openFunctions, (f) => f.name)
      .slice(0, WANTED_SHOWN)
      .map(({ item, games: slugs }) => ({ name: item.name, library: item.library, games: slugs.map((s) => name.get(s) ?? s) })),
    release: release && {
      tag: release.tag,
      name: release.name,
      url: release.url,
      published: release.published,
      downloads: { linux: asset(/^relinker-v[\d.]+$/), windows: asset(/^relinker-v[\d.]+\.exe$/), librariesLinux: asset(/^prx-linux-.*\.zip$/), librariesWindows: asset(/^prx-windows-.*\.zip$/) },
    },
    tracked: latest
      ? {
          release: latest,
          // Furthest first, so the bot can list them as they are.
          games: trackedGames
            .map((g) => {
              const on = tested.get(g.slug)?.releases.find((r) => r.release === latest);
              return { slug: g.slug, name: g.name, stage: on?.stage ?? null, ready: retest.get(g.slug)?.ready ?? false };
            })
            .sort((a, b) => stageRank(b.stage) - stageRank(a.stage) || a.name.localeCompare(b.name)),
        }
      : null,
    faq: strings("en").faq.groups.flatMap((group, gi) => group.questions.map(({ q, a }, qi) => ({ id: `q${gi + 1}-${qi + 1}`, q, a: markdown(a) }))),
    answers: text.answers,
    rules: text.rules.trim() || null,
  };
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
