import { day, header, join, link, textLink } from "../markdown";
import { AREA_LABEL, AREAS, typeLabel, type ClassifiedMerge } from "../merges";
import { stageRank } from "../stages";
import type { Update } from "../updates";

/** Events and daily summaries listed, by age; single merges are listed for a shorter span, as there are ~200 a day. */
const EVENT_DAYS = 30;
const MERGE_DAYS = 3;
const DAY = 864e5;

const KIND_LABEL: Partial<Record<Update["kind"], string>> = {
  release: "Release",
  stage: "Game",
  regression: "Possible regression",
  retest: "Retest",
  library: "Library milestone",
  digest: "Merged",
  week: "Week",
};

function merges(list: ClassifiedMerge[]): string {
  return AREAS.map((area) => {
    const here = list.filter((m) => m.area === area);
    if (!here.length) return null;
    return [`#### ${AREA_LABEL[area]} (${here.length})`, here.map((m) => `- ${typeLabel(m.type)}${m.library ? ` in ${m.library}` : ""}: ${m.summary} (#${m.number}${m.author ? ` by ${m.author}` : ""})${m.titleIds.length ? `; names ${m.titleIds.join(", ")}` : ""}`).join("\n")].join("\n\n");
  })
    .filter(Boolean)
    .join("\n\n");
}

/** The Updates page as Markdown: what happened, newest first, with the merges of the last week in full. */
export function updatesText({ updates, site }: { updates: Update[]; site: URL | undefined }): string {
  const newest = Date.parse(updates[0]?.date ?? new Date().toISOString());
  const recent = updates.filter((u) => u.kind !== "merge" && newest - Date.parse(u.date) <= EVENT_DAYS * DAY);
  const byDay = Map.groupBy(recent, (u) => day(u.date));
  const item = (u: Update) => `- ${day(u.date)}: ${u.title} (${textLink(site, u.url)})`;
  const releases = recent.filter((u) => u.kind === "release");
  const gameplay = recent.filter((u) => u.kind === "stage" && stageRank(u.stage) >= stageRank("Ingame"));
  const regressions = recent.filter((u) => u.kind === "regression");
  const completed = recent.filter((u) => u.kind === "library" && u.milestone === "complete");
  const highlights = [
    `## Summary of the last ${EVENT_DAYS} days`,
    `${releases.length} release${releases.length === 1 ? "" : "s"}, ${recent.filter((u) => u.kind === "stage").length} games reaching a new stage (${gameplay.length} of them reaching gameplay or further), ${regressions.length} possible regressions and ${completed.length} system libraries completed. The day-by-day list below has every event.`,
    releases.length > 0 && ["### Releases", releases.map(item).join("\n")].join("\n\n"),
    gameplay.length > 0 && ["### Games reaching gameplay or further", gameplay.map(item).join("\n")].join("\n\n"),
    regressions.length > 0 && ["### Possible regressions", "A newer release got less far than an earlier one: a regression, or a different setup.", regressions.map(item).join("\n")].join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const days = [...byDay.entries()].map(([date, list]) => {
    const digest = list.find((u) => u.kind === "digest");
    const events = list.filter((u) => u.kind !== "digest");
    return [
      `### ${date}`,
      events.map((u) => `- ${KIND_LABEL[u.kind] ?? u.kind}: ${u.title}. ${u.text} (${textLink(site, u.url)})`).join("\n"),
      digest && `${digest.title}. ${digest.text}`,
      digest?.merges && newest - Date.parse(digest.date) <= MERGE_DAYS * DAY && merges(digest.merges),
    ]
      .filter(Boolean)
      .join("\n\n");
  });

  return join([
    header(
      site,
      "AnyPS5 updates",
      "/updates",
      `What happened in AnyPS5 over the last ${EVENT_DAYS} days, newest first: releases, games reaching new stages, possible regressions, library milestones and what was merged upstream each day. Single merges are listed for the last ${MERGE_DAYS} days.`,
    ),
    [
      "Atom feeds:",
      "",
      `- Everything except single merges: ${link(site, "/updates.xml")}`,
      `- Releases: ${link(site, "/feeds/releases.xml")}`,
      `- Every feature, fix and speed-up merged: ${link(site, "/feeds/progress.xml")}`,
      `- One summary per day: ${link(site, "/feeds/progress-daily.xml")}`,
      `- Games: ${link(site, "/feeds/games.xml")}`,
    ].join("\n"),
    highlights,
    "## Day by day",
    ...days,
  ]);
}
