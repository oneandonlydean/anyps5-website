import { atLeast, gameSeries } from "../compat-history";
import type { GameNeeds } from "../data";
import { LIBRARY_AREAS, libraryArea } from "../library-areas";
import { code, count, day, header, join, link, percent, table } from "../markdown";
import { openFunctions, tallyWanted } from "../needs";
import { weeklyPace } from "../progress-summary";
import type { Game } from "../resolve";
import { REPO_URL } from "../site";
import type { CompatHistory } from "../compat-history";
import type { Commits, Coverage, ProgressDay, ProgressPart } from "../upstream";

export interface ProgressTextInput {
  progress: { libraries: ProgressPart } | null;
  libraryHistory: ProgressDay[];
  coverage: Coverage | null;
  needs: Map<string, GameNeeds>;
  games: Game[];
  compatHistory: CompatHistory | null;
  commits: Commits | null;
  today: string;
  site: URL | undefined;
}

/** Encodings in reading order, with what each one is for; the same as the progress page. */
const ENCODINGS: Record<string, string> = {
  SOP1: "Scalar ALU, one operand",
  SOP2: "Scalar ALU, two operands",
  SOPK: "Scalar ALU with an inline constant",
  SOPC: "Scalar compare",
  SOPP: "Program control and branches",
  SMEM: "Scalar memory",
  VOP1: "Vector ALU, one operand",
  VOP2: "Vector ALU, two operands",
  VOP3: "Vector ALU, three operands",
  VOP3P: "Packed vector math",
  VOPC: "Vector compare",
  VINTRP: "Attribute interpolation",
  DS: "Local and global data share",
  MUBUF: "Untyped buffer memory",
  MTBUF: "Typed buffer memory",
  MIMG: "Image sample, load and store",
  FLAT: "Flat memory",
  GLOBAL: "Global memory",
  SCRATCH: "Scratch memory",
  EXP: "Export to render targets",
};
const FORM_LABEL = { base: "own encoding", vop3: "as VOP3", dpp16: "DPP16", dpp8: "DPP8" } as const;

/** The day closest to `days` before the last one, for "change since" figures. */
function before(history: Coverage["history"], days: number) {
  const last = new Date(history.at(-1)!.date).getTime();
  return history.find((h) => last - new Date(h.date).getTime() <= days * 864e5) ?? history[0];
}

/** The progress page as Markdown: games, development pace, system libraries, the shader recompiler and what games wait on. */
export function progressText({ progress, libraryHistory, coverage, needs, games, compatHistory, commits, today, site }: ProgressTextInput): string {
  const gameName = new Map(games.map((g) => [g.slug, g.name]));
  const gameLinks = (slugs: string[]) => slugs.map((s) => `[${gameName.get(s) ?? s}](${link(site, `/compatibility/${s}.md`)})`).join(", ");
  const sign = (n: number) => (n > 0 ? `+${count(n)}` : n < 0 ? `−${count(-n)}` : "±0");

  // Games
  const compat = gameSeries(games, compatHistory, today);
  const now = compat.days.at(-1)?.counts ?? {};
  const from = compat.days.at(-31) ?? compat.days[0];
  const then = from?.counts ?? {};
  const gamesPart = compat.days.length > 0 && [
    "## Games",
    `How many games reach each point: the furthest stage on a main or release build. The compatibility list (${link(site, "/compatibility.md")}) also counts stages reached only with open pull requests, so its figures are higher.`,
    table(
      ["", "Now", from ? `Change since ${day(from.date)}` : "Change"],
      [
        ["Tested", count(atLeast(now, null)), sign(atLeast(now, null) - atLeast(then, null))],
        ["Presents or better", count(atLeast(now, "Presents")), sign(atLeast(now, "Presents") - atLeast(then, "Presents"))],
        ["Ingame or better", count(atLeast(now, "Ingame")), sign(atLeast(now, "Ingame") - atLeast(then, "Ingame"))],
      ],
    ),
    "### The last 7 days",
    table(
      ["", "This week", "The week before"],
      weeklyPace(games, libraryHistory, today).map((p) => [p.label, p.now === null ? null : count(p.now), p.before === null ? null : count(p.before)]),
    ),
  ];

  // Development
  const commitDays = commits?.days ?? [];
  const partial = commitDays.at(-1)?.date === commits?.synced.slice(0, 10);
  const fullDays = partial ? commitDays.slice(0, -1) : commitDays;
  const commitWeek = (skip: number) => fullDays.slice(Math.max(0, fullDays.length - skip - 7), fullDays.length - skip).reduce((n, d) => n + d.commits, 0);
  const busiest = fullDays.reduce<(typeof fullDays)[number] | undefined>((best, d) => (!best || d.commits > best.commits ? d : best), undefined);
  const development = commitDays.length > 1 && [
    "## Development",
    `Commits on upstream main (${REPO_URL}), by the UTC day they were written, merge commits included.`,
    [
      `- Total since ${day(commitDays[0].date)}: ${count(commitDays.reduce((n, d) => n + d.commits, 0))}`,
      `- Last 7 full days: ${count(commitWeek(0))}; the 7 days before: ${count(commitWeek(7))}`,
      busiest && `- Busiest day: ${day(busiest.date)}, ${count(busiest.commits)} commits`,
      `- What was merged day by day: ${link(site, "/updates.md")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  ];

  // System libraries
  const libraries = progress?.libraries;
  const waiting = tallyWanted(needs, openFunctions, (f) => f.name);
  const waitingByLibrary = new Map<string, Set<string>>();
  for (const { item, games: slugs } of waiting) for (const s of slugs) (waitingByLibrary.get(item.library) ?? waitingByLibrary.set(item.library, new Set()).get(item.library)!).add(s);
  const libraryPart = libraries && [
    "## System libraries",
    `${percent(libraries.done, libraries.total)} of declared functions implemented: ${count(libraries.done)} of ${count(libraries.total)} (${count(libraries.total - libraries.done)} missing). ${count(libraries.groups.reduce((n, g) => n + g.inert, 0))} implemented functions are no-op bodies (they only discard their arguments and return a constant). ${libraries.groups.filter((g) => g.done === g.total).length} of ${libraries.groups.length} libraries are complete. The total grows as more functions are found.`,
    libraryHistory.length > 1 &&
      (() => {
        const first = libraryHistory[0];
        const month = libraryHistory.filter((d) => Date.parse(d.date) <= Date.parse(today) - 30 * 864e5).at(-1) ?? first;
        return `Implemented functions: ${count(first.libraries.done)} on ${day(first.date)}, ${count(month.libraries.done)} on ${day(month.date)}, ${count(libraryHistory.at(-1)!.libraries.done)} on ${day(libraryHistory.at(-1)!.date)}.`;
      })(),
    "### By area",
    table(
      ["Area", "Libraries", "Implemented", "Functions", "Done"],
      LIBRARY_AREAS.map((area) => {
        const groups = libraries.groups.filter((g) => libraryArea(g.name) === area);
        const done = groups.reduce((n, g) => n + g.done, 0);
        const total = groups.reduce((n, g) => n + g.total, 0);
        return [area, groups.length, count(done), count(total), percent(done, total, 1)];
      }),
    ),
    "### Every library",
    "Sorted by area, then by most functions missing. \"Games waiting\" counts games whose newest blocker names a function in the library that is still open.",
    table(
      ["Library", "Area", "Implemented", "Functions", "Done", "No-op", "Games waiting"],
      [...libraries.groups]
        .sort((a, b) => LIBRARY_AREAS.indexOf(libraryArea(a.name)) - LIBRARY_AREAS.indexOf(libraryArea(b.name)) || b.total - b.done - (a.total - a.done) || a.name.localeCompare(b.name))
        .map((g) => [g.label, libraryArea(g.name), count(g.done), count(g.total), percent(g.done, g.total, 1), g.inert || null, waitingByLibrary.get(g.label)?.size ?? null]),
    ),
    `Every function name with whether it is implemented: ${link(site, "/bot/lookup.json")} (JSON; "functions" is [name, library index, implemented]).`,
  ];

  // Shader recompiler
  const shaders =
    coverage &&
    (() => {
      const since = { first: coverage.history[0], month: before(coverage.history, 30) };
      const rows = Object.keys(ENCODINGS).flatMap((encoding) => {
        const forms = coverage.forms.filter((f) => f.encoding === encoding);
        if (!forms.length) return [];
        const decoded = forms.reduce((n, f) => n + f.decoded, 0);
        const total = forms.reduce((n, f) => n + f.total, 0);
        const missing = forms.flatMap((f) => f.missing.map((name) => (forms.length > 1 ? `${name} (${FORM_LABEL[f.form]})` : name)));
        return [[encoding, ENCODINGS[encoding], `${decoded}/${total}`, forms.map((f) => `${FORM_LABEL[f.form]} ${f.decoded}/${f.total}`).join(", "), missing.length ? missing.join(", ") : null]];
      });
      const byFile = Object.entries(Object.groupBy(coverage.throws.sites, (s) => s.file)).sort((a, b) => b[1]!.length - a[1]!.length || a[0].localeCompare(b[0]));
      const source = (file: string, line: number) => `${REPO_URL}/blob/${coverage.commit}/core/shader/recompiler/${file}#L${line}`;
      const unhandled = coverage.formatRows.filter((f) => !f.sampled && !f.buffer && !f.host);
      return [
        `## Shader recompiler: translating ${coverage.isa} shaders to Vulkan`,
        `Measured against AMD's machine-readable ${coverage.isa} instruction set, on upstream main at ${coverage.commit.slice(0, 9)} (${day(coverage.date)}).`,
        [
          `- Instruction forms: ${percent(coverage.instructions.decoded, coverage.instructions.total)}, ${count(coverage.instructions.decoded)} of ${count(coverage.instructions.total)} decode${coverage.instructions.decoded === coverage.instructions.translated ? " and translate" : `; ${count(coverage.instructions.translated)} also translate`}`,
          `- DPP lane-swizzle forms: ${percent(coverage.dpp.decoded, coverage.dpp.total)}, ${coverage.dpp.decoded} of ${coverage.dpp.total} DPP16 and DPP8 forms`,
          `- Image formats: ${coverage.formats.sampled} of ${coverage.formats.total} can be sampled; ${coverage.formats.buffer} as typed buffers; ${coverage.formats.host} map to Vulkan`,
          `- Image descriptor types handled: ${coverage.descriptors.filter((d) => d.handled).length} of ${coverage.descriptors.length}${coverage.descriptors.some((d) => !d.handled) ? ` (not yet: ${coverage.descriptors.filter((d) => !d.handled).map((d) => d.name).join(", ")})` : ""}`,
          `- Unsupported cases left: ${coverage.throws.total} (${since.first.throws} on ${day(since.first.date)}; ${sign(coverage.throws.total - since.month.throws)} in 30 days). New support often adds these before removing them, so the count can rise before it falls.`,
        ].join("\n"),
        "### Instructions by encoding",
        table(["Encoding", "What it is", "Decoded", "By form", "Not decoded"], rows),
        coverage.untranslated.length > 0 && `Decoded but not yet translated: ${coverage.untranslated.map(code).join(", ")}`,
        "### Unsupported cases by component",
        table(
          ["Component", "Cases"],
          coverage.throws.areas.map((a) => [a.name, a.count]),
        ),
        "### Every unsupported case",
        "Spots where the recompiler stops on something it doesn't handle yet, by source file.",
        byFile.map(([file, sites]) => [`#### ${file} (${sites!.length})`, sites!.map((s) => `- L${s.line} (${source(s.file, s.line)}): ${code(s.message)}`).join("\n")].join("\n\n")).join("\n\n"),
        "### Image formats nothing handles yet",
        unhandled.length ? unhandled.map((f) => `${f.name ?? "unnamed"} (${f.value})`).join(", ") : "None.",
      ];
    })();

  // What games are waiting on
  const wantedErrors = tallyWanted(needs, (n) => n.errors, (e) => e.message);
  const wanted = (waiting.length > 0 || wantedErrors.length > 0) && [
    "## What games are waiting on",
    "Functions and errors named in each game's newest bring-up report that are still open in today's source, by how many games name them. Fixing one of these moves real games forward.",
    waiting.length > 0 && "### System functions",
    waiting.length > 0 && table(["Function", "Library", "Status", "Games", "Which games"], waiting.map(({ item, games: slugs }) => [code(item.name), item.library, item.status === "undeclared" ? "not declared yet" : "missing", slugs.length, gameLinks(slugs)])),
    wantedErrors.length > 0 && "### Errors",
    wantedErrors.length > 0 &&
      table(
        ["Error", "Raised at", "Games", "Which games"],
        wantedErrors.map(({ item, games: slugs }) => [code(item.message), item.sites.map((s) => `${s.file}:${s.line}`).join(", "), slugs.length, gameLinks(slugs)]),
      ),
  ];

  return join([
    header(
      site,
      "AnyPS5 progress",
      "/progress",
      [
        libraries && `${percent(libraries.done, libraries.total)} of system library functions implemented`,
        coverage && `${percent(coverage.instructions.decoded, coverage.instructions.total)} of ${coverage.isa} shader instruction forms decode`,
        compat.days.length > 0 && `${count(atLeast(now, "Ingame"))} games reach gameplay`,
      ]
        .filter(Boolean)
        .join("; ") + ".",
    ),
    gamesPart && gamesPart.join("\n\n"),
    development && development.join("\n\n"),
    wanted && wanted.filter(Boolean).join("\n\n"),
    libraryPart && libraryPart.filter(Boolean).join("\n\n"),
    shaders && shaders.filter(Boolean).join("\n\n"),
    "## How it's measured",
    [
      `- System libraries: from upstream's own progress report (${REPO_URL}/blob/main/docs/dev/PROGRESS.md). A function counts as implemented unless its body calls the not-implemented stub. No-op bodies are counted as implemented and shown separately.`,
      "- Shader recompiler: each build reads the recompiler's opcode tables, its DPP rules, its translator, its format tables and its error sites straight from upstream source, and compares them with AMD's machine-readable ISA. Earlier days are measured again with the same rules, so the figures stay comparable. If upstream reorganises this code, the build stops instead of publishing wrong numbers.",
      "- Not measured yet: whether every operand modifier combination is accepted (VOP3 abs, neg, clamp and omod, op_sel, SDWA byte and word selects, and integer source modifiers inside DPP). Those are decided by code paths a source scan cannot follow; counting them needs a harness that runs the decoder itself.",
      "- What games are waiting on: each game's newest blocker text is matched against every declared function and every error the recompiler and GPU driver can raise.",
    ].join("\n"),
  ]);
}
