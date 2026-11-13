import { describe, expect, it } from "vitest";
import { getBuilds, getGames, getNeeds, getRetest, getScreenshots, getTested } from "../src/lib/data";
import { compatibilityText } from "../src/lib/text/compatibility";
import { gameText } from "../src/lib/text/game";
import { progressText } from "../src/lib/text/progress";
import { getCommits, getCompatHistory, getCoverage, getProgress, getProgressHistory } from "../src/lib/upstream";

// Rendered from the committed data in data/generated, so a change that empties a section or prints an object shows here.
const site = new URL("https://anyps5.gg");
const broken = /undefined|\[object Object\]|NaN/;
/** What the code wrote, without text quoted from reports and notes, which may say "undefined symbol" themselves. */
const own = (text: string, quoted: (string | null | undefined)[] = []) =>
  quoted.reduce<string>((t, q) => (q ? t.split(q).join("") : t), text.replace(/(`{3,})text\n[\s\S]*?\n\1/g, ""));

describe("Markdown copies of the pages", async () => {
  const [games, needs, retest, tested, builds, shots] = await Promise.all([getGames(), getNeeds(), getRetest(), getTested(), getBuilds(), getScreenshots()]);
  const render = (slug: string) => {
    const game = games.find((g) => g.slug === slug)!;
    return gameText({ game, needs: needs.get(slug), retest: retest.get(slug)!, tested: tested.get(slug)!, builds, shots: shots.get(slug) ?? [], site });
  };

  it("gives a game page its stage, what it needs and every report", () => {
    const game = games.find((g) => needs.has(g.slug) && g.reports.length > 1 && tested.get(g.slug)!.releases.length > 0)!;
    const text = render(game.slug);
    expect(text).toMatch(new RegExp(`^# ${game.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n`));
    for (const section of ["## Facts", "## What it needs", "## By release", "## Test reports"]) expect(text).toContain(section);
    expect(text).toContain(`## Test reports (${game.reports.length + game.uploads.length})`);
    expect(text).toContain(game.titleIds[0]);
    expect(text).not.toMatch(broken);
  });

  it("renders every game without gaps", () => {
    for (const game of games) {
      const quoted = [game.note, ...game.uploads.map((u) => u.stop.message), ...game.blockers.map((b) => b.title), ...(game.branch?.prs.map((p) => p.title) ?? [])];
      expect(own(render(game.slug), quoted), game.slug).not.toMatch(broken);
    }
  });

  it("lists every game on the compatibility page", () => {
    const text = compatibilityText({ games, retest, needs, site });
    for (const game of games) expect(text).toContain(`https://anyps5.gg/compatibility/${game.slug}.md`);
    expect(text).not.toMatch(broken);
  });

  it("covers libraries, shaders and what games wait on in progress", async () => {
    const [progress, libraryHistory, coverage, compatHistory, commits] = await Promise.all([getProgress(), getProgressHistory(), getCoverage(), getCompatHistory(), getCommits()]);
    const text = progressText({ progress, libraryHistory, coverage, needs, games, compatHistory, commits, today: new Date().toISOString().slice(0, 10), site });
    for (const section of ["## Games", "## What games are waiting on", "## System libraries", "## Shader recompiler", "## How it's measured"]) expect(text).toContain(section);
    expect(text).not.toMatch(broken);
  });
});
