import type { APIRoute } from "astro";
import { atLeast, gameSeries } from "../../../lib/compat-history";
import { getGames } from "../../../lib/data";
import { gamesImage, librariesImage, shadersImage } from "../../../lib/og";
import { NOT_CONVERTING, STAGES, type StageOrNone } from "../../../lib/stages";
import { getCompatHistory, getCoverage, getProgress } from "../../../lib/upstream";

/**
 * The pictures for the Discord bot's /progress libraries, shaders and games, from the same data as the progress page.
 * An area whose data is missing is left out, and the command falls back to text.
 */

const BIGGEST = 9;

export async function getStaticPaths() {
  const [progress, coverage] = await Promise.all([getProgress(), getCoverage()]);
  return [...(progress ? ["libraries"] : []), ...(coverage?.instructions ? ["shaders"] : []), "games"].map((area) => ({ params: { area } }));
}

export const GET: APIRoute = async ({ params }) => {
  const date = new Date().toISOString().slice(0, 10);
  if (params.area === "libraries") {
    const l = (await getProgress())!.libraries;
    const groups = l.groups.filter((g) => g.total > 0);
    const complete = groups.filter((g) => g.done === g.total).length;
    const started = groups.filter((g) => g.done > 0 && g.done < g.total).length;
    return librariesImage({
      date,
      done: l.done,
      total: l.total,
      complete,
      started,
      untouched: groups.length - complete - started,
      biggest: [...groups].sort((a, b) => b.total - a.total).slice(0, BIGGEST).map((g) => ({ name: g.label, done: g.done, total: g.total })),
    });
  }
  if (params.area === "shaders") {
    const c = (await getCoverage())!;
    return shadersImage({ date, instructions: c.instructions!, dpp: c.dpp, formats: c.formats, throws: { total: c.throws.total, areas: c.throws.areas } });
  }
  const [games, history] = await Promise.all([getGames(), getCompatHistory()]);
  const days = gameSeries(games, history, date).days;
  const now = days.at(-1)?.counts ?? {};
  const before = days.length > 7 ? days.at(-8)!.counts : null;
  const order: StageOrNone[] = [...STAGES.map((s) => s.name).reverse(), NOT_CONVERTING];
  return gamesImage({
    date,
    tested: atLeast(now, null),
    gameplay: atLeast(now, "Ingame"),
    week: before ? atLeast(now, "Ingame") - atLeast(before, "Ingame") : null,
    stages: order.map((stage) => ({ stage, count: now[stage] ?? 0 })),
  });
};
