import { atLeast, gameSeries } from "../../lib/compat-history";
import { getGames } from "../../lib/data";
import { progressImage } from "../../lib/og";
import { STAGES, NOT_CONVERTING, type StageOrNone } from "../../lib/stages";
import { getCommits, getCompatHistory, getCoverage, getProgress } from "../../lib/upstream";

/** The picture the Discord bot's /progress shows, from the same data as the progress page. */

const COMMIT_DAYS = 30;

export async function GET() {
  const [progress, coverage, games, compatHistory, commits] = await Promise.all([getProgress(), getCoverage(), getGames(), getCompatHistory(), getCommits()]);
  const today = new Date().toISOString().slice(0, 10);
  const counts = gameSeries(games, compatHistory, today).days.at(-1)?.counts ?? {};
  const order: StageOrNone[] = [...STAGES.map((s) => s.name).reverse(), NOT_CONVERTING];
  return progressImage({
    date: today,
    libraries: progress ? { done: progress.libraries.done, total: progress.libraries.total } : null,
    shaders: coverage?.instructions ? { decoded: coverage.instructions.decoded, total: coverage.instructions.total } : null,
    games: {
      stages: order.map((stage) => ({ stage, count: counts[stage] ?? 0 })),
      tested: atLeast(counts, null),
      gameplay: atLeast(counts, "Ingame"),
    },
    commits: (commits?.days ?? []).slice(-COMMIT_DAYS),
  });
}
