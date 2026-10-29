/**
 * Measures shader recompiler coverage on upstream `main` today and on the last commit of every earlier day, then
 * writes data/generated/coverage.json. History is re-measured from scratch each run with the current rules, so the
 * series stays comparable and there is no stored state to maintain.
 */
import { generated, writeJson } from "./lib/files";
import { dailyCommits, headCommit, listTree, prefetch, readTree, syncUpstream } from "./lib/git";
import { loadIsaXml, parseIsa } from "./lib/isa";
import { area, errorSites, measure, SCANNED_DIRECTORIES, type Snapshot } from "./lib/coverage";

const count = <T>(items: T[], test: (item: T) => boolean) => items.reduce((n, item) => n + (test(item) ? 1 : 0), 0);

type Forms = NonNullable<Snapshot["forms"]>;
const sum = (forms: Forms, key: "total" | "decoded" | "translated") => forms.reduce((n, f) => n + f[key], 0);

/** The numbers the history chart plots for one day; null where that day's tree could not be measured. */
function summary(s: Snapshot) {
  const plain = s.forms?.filter((f) => f.form === "base" || f.form === "vop3") ?? [];
  const dpp = s.forms?.filter((f) => f.form === "dpp16" || f.form === "dpp8") ?? [];
  return {
    instructions: plain.length ? { total: sum(plain, "total"), decoded: sum(plain, "decoded"), translated: sum(plain, "translated") } : null,
    dpp: dpp.length ? { total: sum(dpp, "total"), decoded: sum(dpp, "decoded") } : null,
    formats: s.formats && { total: s.formats.length, sampled: count(s.formats, (f) => f.sampled), buffer: count(s.formats, (f) => f.buffer), host: count(s.formats, (f) => f.host) },
    throws: s.throws.length,
  };
}

async function main() {
  await syncUpstream();
  const isa = parseIsa(await loadIsaXml());
  const head = await headCommit();
  const headFiles = await readTree(head.commit, SCANNED_DIRECTORIES);
  const now = measure(headFiles, isa);

  // Fetch every historical file version in one go before measuring the days one by one.
  const days = await dailyCommits();
  const trees = await Promise.all(days.map((d) => listTree(d.commit, SCANNED_DIRECTORIES)));
  await prefetch(trees.flat().map((e) => e.object));

  // Older trees predate some of the scanned structures, so they are measured leniently: a metric whose code does not
  // exist yet is null for that day rather than a misleading zero.
  const history = [];
  for (const day of days) {
    const files = await readTree(day.commit, SCANNED_DIRECTORIES);
    if ([...files.keys()].some((path) => path.startsWith("core/shader/recompiler/"))) history.push({ ...day, ...summary(measure(files, isa, true)) });
  }

  const areas = new Map<string, number>();
  for (const site of now.throws) areas.set(area(site.file), (areas.get(area(site.file)) ?? 0) + 1);

  await writeJson(generated("coverage.json"), {
    commit: head.commit,
    date: head.date,
    isa: "AMD RDNA 2",
    ...summary(now),
    forms: now.forms,
    untranslated: now.untranslated,
    formatRows: now.formats,
    descriptors: now.descriptors,
    throws: { total: now.throws.length, areas: [...areas].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), sites: now.throws },
    history,
  });
  // Matched against the errors quoted in bring-up reports; only the build reads it.
  await writeJson(generated("error-sites.json"), { commit: head.commit, sites: errorSites(headFiles) });

  const s = summary(now);
  console.log(
    `coverage: ${s.instructions?.decoded}/${s.instructions?.total} instruction forms, ${s.dpp?.decoded}/${s.dpp?.total} DPP forms, ${s.throws} unsupported throws, ${history.length} days`,
  );
}

await main();
