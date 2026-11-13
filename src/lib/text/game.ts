import { buildLabel, type BuildData, type Tested } from "../builds";
import type { GameNeeds, Retest } from "../data";
import { reportRows, type ReportRow } from "../game-rows";
import { code, count, day, header, inline, join, link, quote, stageLine, table } from "../markdown";
import type { Game } from "../resolve";
import type { Screenshot } from "../screenshots";
import { REPO_URL } from "../site";
import { CONFIRMATIONS_NEEDED, type UploadSummary } from "../uploads";
import { PLATFORM_LABEL, reach, regionName } from "../view";

export interface GameTextInput {
  game: Game;
  needs: GameNeeds | undefined;
  retest: Retest;
  tested: Tested;
  builds: BuildData;
  shots: Screenshot[];
  site: URL | undefined;
}

const KIND = { retail: "Retail game", homebrew: "Homebrew", app: "App" } as const;
const STATUS = { missing: "missing", undeclared: "not declared yet", implemented: "implemented since" } as const;
/** Report text quoted per report; longer text is cut, and the full report is a link away. */
const QUOTED = 2000;

const system = (row: Pick<ReportRow, "os" | "gpuVendor" | "gpu">) =>
  [row.os && (PLATFORM_LABEL[row.os as keyof typeof PLATFORM_LABEL] ?? row.os), row.gpu ?? row.gpuVendor].filter(Boolean).join(", ") || null;

const cut = (text: string) => (text.length > QUOTED ? `${text.slice(0, QUOTED).trimEnd()}\n[… cut; the full text is in the report]` : text);

/** One uploaded run report's details: how the run ended, what it found missing, and how fast it ran. */
function uploadDetails(u: UploadSummary): string[] {
  const lines: string[] = [];
  if (u.stated) lines.push(`- The tester said the run reached ${u.stated}; a run report itself records stages only up to Presents.`);
  if (u.verifiedBy) lines.push(`- Checked and verified by maintainer ${u.verifiedBy}.`);
  if (u.contentVersion) lines.push(`- Game version: ${u.contentVersion}`);
  const stop = [u.stop.kind !== "none" && u.stop.kind, u.stop.reason].filter(Boolean).join(", ");
  lines.push(`- How the run ended: ${inline(u.exit)} exit${stop ? ` (${inline(stop)})` : ""}${u.stop.message ? `: ${inline(u.stop.message)}` : ""}${u.recovered ? " (written at the next start after an unclean exit)" : ""}`);
  const list = (title: string, names: string[] | null, more: number) =>
    names === null ? `- ${title}: not collected in this run` : names.length ? `- ${title}: ${names.map(code).join(", ")}${more ? ` and ${count(more)} more` : ""}` : `- ${title}: none`;
  lines.push(list("Missing functions called", u.missing, u.truncated.functions));
  lines.push(list("Unsupported GPU or shader features hit", u.unsupported, u.truncated.unsupported));
  const p = u.perf;
  if (p)
    lines.push(
      `- Performance: ${p.fps.toFixed(1)} FPS average, ${p.low1.toFixed(1)} FPS 1% low, ${p.p99Ms.toFixed(1)} ms 99th percentile frame, ${count(p.stutters)} stutters over ${Math.round(p.seconds)} s; GPU busy ${Math.round(p.gpuBusyPct)}%${p.cap ? `; capped at ${p.cap} FPS` : ""}${p.resolutions.length ? `; ${p.resolutions.join(", ")}` : ""}${p.comparable ? "" : " (profiled or modified build: not comparable)"}`,
    );
  return lines;
}

/** A game page as Markdown: how far it gets, where and why it stops, and every report, in full. */
export function gameText({ game, needs, retest, tested, builds, shots, site }: GameTextInput): string {
  const path = `/compatibility/${game.slug}`;
  const { stage, onMain } = reach(game);
  const firstRelease = builds.releases.at(-1)?.tag;
  const label = (info: { release: string | null; exact: boolean }) => buildLabel(info, firstRelease);
  const group = (release: string | null) => (release ? `${release} or main after it` : label({ release: null, exact: false }));
  const rows = reportRows(game, builds);
  const newestRelease = builds.releases[0]?.tag ?? null;
  const onNewest = tested.releases.find((r) => r.release === newestRelease) ?? null;
  const threads = [...game.threads].sort((a, b) => b.comments - a.comments || a.number - b.number);

  const summary = stage
    ? `${game.name} reaches ${stage}${onMain ? "" : " with open pull requests"} on AnyPS5. ${rows.length === 1 ? "1 test report" : `${count(rows.length)} test reports`}${rows[0] ? `, the latest on ${day(rows[0].date)}` : ""}.`
    : `${game.name} has no AnyPS5 test reports yet.`;

  const facts = [
    `- Title IDs: ${game.releases.map((r) => `${r.titleId}${regionName(r.region) ? ` (${regionName(r.region)})` : ""}`).join(", ")}`,
    game.kind !== "retail" && `- Kind: ${KIND[game.kind]}`,
    game.aliases.length > 0 && `- Also known as: ${game.aliases.join(", ")}`,
    `- Stage on main: ${stageLine(game.stage)}. This is the furthest any report has reached on a main or release build, at any time; "By release" below shows each release on its own.`,
    newestRelease &&
      `- On the newest release, ${newestRelease}: ${onNewest ? `${onNewest.stage}${onNewest.approximate ? " (placed by date)" : ""}, from ${onNewest.results} result${onNewest.results === 1 ? "" : "s"}` : "no results yet"}`,
    !onMain && `- Stage with open pull requests or local patches: ${stageLine(stage)}`,
    game.verified && "- Checked by a maintainer",
    game.correction && `- A maintainer set the stage to ${game.correction.stage} on ${day(game.correction.date)}; reports from then or before that claimed more were overruled.`,
    Object.keys(game.platforms).length > 0 &&
      `- By system: ${Object.entries(game.platforms)
        .map(([p, s]) => `${PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL] ?? p}: ${s}`)
        .join("; ")}`,
    game.gpuVendors.length > 0 && `- GPUs tested: ${game.gpuVendors.join(", ")}`,
    `- Testers: ${count(game.reporters)}`,
    retest.lastTested &&
      `- Last tested: ${day(retest.lastTested)}${retest.lastBuild && retest.lastBuild.basis !== "date" ? ` on ${label(retest.lastBuild)}` : ""}; ${retest.releasesSince === 0 ? "on the current release" : `${retest.releasesSince} release${retest.releasesSince === 1 ? "" : "s"} ago`}${retest.stale ? " (stale: a run on the current build is wanted)" : ""}`,
    shots.length > 0 && `- Community screenshots: ${count(shots.length)} on the HTML page`,
    ...threads.map((t, i) => `- ${i === 0 ? "Discussion" : `Discussion #${t.number}`}: ${t.url} (${t.comments === 1 ? "1 reply" : `${count(t.comments)} replies`})`),
    `- Upload a run report: ${link(site, `/report?game=${game.slug}`)}`,
    `- Feed for this game: ${link(site, `${path}.xml`)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const retestText =
    retest.ready || retest.stale
      ? [
          `## ${retest.ready ? "Ready to retest" : "Due a fresh run"}`,
          retest.ready
            ? `What stopped it last time has been fixed since the report of ${day(retest.lastTested!)}: ${[
                retest.fixed.functions.length > 0 && `${retest.fixed.functions.length} named function${retest.fixed.functions.length === 1 ? " is" : "s are"} implemented now (${retest.fixed.functions.map(code).join(", ")})`,
                retest.fixed.issues.length > 0 && retest.fixed.issues.map((i) => `#${i.number} ${i.state} (${i.url})`).join(", "),
              ]
                .filter(Boolean)
                .join("; ")}. A new run will show how much further it gets.`
            : `The newest report is from ${day(retest.lastTested!)}${retest.releasesSince > 1 ? `, ${retest.releasesSince} releases ago` : ""}. A run on the current build would keep this page accurate.`,
        ].join("\n\n")
      : null;

  const branch = game.branch && [
    "## Reached only with changes not on main",
    `The report that got to ${game.branchStage} (${game.branch.url}) ${game.branch.prs.length ? "used these pull requests:" : "describes its local patches."}`,
    game.branch.prs.map((p) => `- #${p.number} ${p.title} (${p.state}): ${p.url}`).join("\n"),
  ];

  const stops = (game.note || game.blockers.length > 0) && [
    "## Where it stops",
    game.note,
    game.noteFrom && `From ${game.noteFrom.author ? `${game.noteFrom.author}'s report` : "a report"}: ${game.noteFrom.url}`,
    game.blockers.length > 0 && ["Blocking issues and pull requests:", game.blockers.map((b) => `- ${b.kind === "pr" ? "Pull request" : "Issue"} #${b.number} (${b.state}): ${b.title}, ${b.url}`).join("\n")].join("\n\n"),
  ];

  const source = (file: string, line: number) => `${REPO_URL}/blob/${needs!.commit}/${file}#L${line}`;
  const needsText = needs && [
    "## What it needs",
    `Read from the newest report with a blocker (${needs.report.author ?? "unknown"}, ${day(needs.report.date)}: ${needs.report.url}) and checked against today's upstream source.`,
    needs.functions.length > 0 &&
      ["### System functions", needs.functions.map((f) => `- ${code(f.name)} in ${f.library}: ${STATUS[f.status]}`).join("\n")].join("\n\n"),
    needs.errors.length > 0 &&
      ["### Errors it stops on", needs.errors.map((e) => `- ${code(e.message)}, raised at ${e.sites.map((s) => `${s.file}:${s.line} (${source(s.file, s.line)})`).join(", ")}`).join("\n")].join("\n\n"),
  ];

  const byRelease = tested.releases.length > 0 && [
    "## By release",
    tested.regression &&
      `**Reported lower on a newer build.** On ${group(tested.regression.now.release)} it reached ${tested.regression.now.stage}; on ${group(tested.regression.was.release)} it reached ${tested.regression.was.stage}. That can be a regression, or a different setup: another run on the current build would tell.`,
    table(
      ["Build", "Furthest stage", "Results", "Latest"],
      tested.releases.map((r) => [`${r.release ? `${r.release} and main after` : label({ release: null, exact: false })}${r.approximate ? " (by date)" : ""}`, r.stage, r.results, day(r.last)]),
    ),
    "Reports on main and uploaded runs, placed by the commit they were built from. Reports that needed open pull requests or patches are left out. \"By date\" means the results name no commit or release, so they are placed by their date.",
  ];

  const history = game.timeline.length > 0 && [
    "## History",
    game.timeline
      .map((e) => `- ${day(e.date)}: reached ${e.stage}${e.url ? ` (${e.url})` : e.source === "uploads" ? " (confirmed by uploaded run reports)" : " (checked by a maintainer)"}`)
      .join("\n"),
  ];

  const auto = game.autoStage;
  const autoText =
    auto &&
    (auto.confirmed && auto.verifiedBy && auto.confirmations < CONFIRMATIONS_NEEDED
      ? `An uploaded run report reached ${auto.stage}, checked and verified by maintainer ${auto.verifiedBy}.`
      : auto.confirmed
        ? `Uploaded run reports reached ${auto.stage}, confirmed by ${auto.confirmations} ${auto.confirmations === 1 ? "report" : "reports"}.`
        : `An uploaded run report reached ${auto.stage}: ${auto.confirmations} of ${CONFIRMATIONS_NEEDED} confirmations. It counts toward the game's stage once another tester confirms it.`);

  const reportTable =
    rows.length > 0
      ? table(
          ["Date", "Stage", "System", "Build", "By", "Source"],
          rows.map((r) => [day(r.date), `${r.stage ?? "Unknown"}${r.stated ? " (unconfirmed)" : ""}`, system(r), `${r.build}${r.byDate ? " (by date)" : ""}`, r.by, r.upload !== undefined ? "Uploaded run report" : "GitHub Discussions"]),
        )
      : "No structured reports yet. The discussion thread may still have notes.";

  const details = rows.map((r) => {
    const title = `### ${day(r.date)}: ${r.stage ?? "Unknown stage"}${r.by ? ` by ${r.by}` : ""}`;
    const lines = [
      `- Source: ${r.upload !== undefined ? `run report uploaded on the site (${link(site, `${path}?report=u${r.upload}`)})` : `GitHub Discussions (${r.href})`}`,
      system(r) && `- System: ${system(r)}`,
      `- Build: ${r.build === "—" ? "not stated" : r.build}${r.byDate ? " (placed by date)" : ""}${r.buildTitle && r.buildTitle !== r.build ? `; as written: ${inline(r.buildTitle)}` : ""}`,
    ];
    const rep = r.report;
    if (rep) {
      if (rep.version) lines.push(`- Game version: ${rep.version}`);
      if (rep.prs.length) lines.push(`- Pull requests in the build: ${rep.prs.map((n) => `#${n}`).join(", ")}`);
      if (rep.edited) lines.push(`- Edited ${day(rep.edited)}`);
    }
    if (r.uploaded) lines.push(...uploadDetails(r.uploaded));
    return [
      title,
      lines.filter(Boolean).join("\n"),
      rep?.shown && ["What it showed:", quote(cut(rep.shown))].join("\n\n"),
      rep?.blockerText && ["Current blocker, as reported:", quote(cut(rep.blockerText))].join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n");
  });

  return join([
    header(site, game.name, path, summary),
    "## Facts",
    facts,
    retestText,
    branch && branch.join("\n\n"),
    stops && stops.filter(Boolean).join("\n\n"),
    needsText && needsText.filter(Boolean).join("\n\n"),
    byRelease && byRelease.filter(Boolean).join("\n\n"),
    history && history.join("\n\n"),
    `## Test reports (${count(rows.length)})`,
    autoText,
    reportTable,
    ...details,
  ]);
}
