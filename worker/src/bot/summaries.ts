import { AREA_LABEL, classify, type MergeArea } from "../../../src/lib/merges";
import { baseUrl, type Ctx } from "./env";
import type * as github from "./github";
import { meter, siteData, type SiteData } from "./site-data";

/**
 * The longer posts: a release with what went into it, and a weekly summary of progress. Both count merges from the
 * bot's merge history (the merges table), sorted with the site's own classifier.
 */

const HIGHLIGHTS = 5;

interface MergeRow {
  number: number;
  title: string;
  author_login: string;
  merged_at: string;
}

/** User-facing merges between two times, by area, with the newest features as highlights. */
export async function mergesBetween(ctx: Ctx, since: string, until: string) {
  const { results } = await ctx.env.DB.prepare("SELECT number, title, author_login, merged_at FROM merges WHERE merged_at > ? AND merged_at <= ? ORDER BY merged_at DESC")
    .bind(since, until)
    .all<MergeRow>();
  const merges = results
    .map((r) => classify({ number: r.number, title: r.title, mergedAt: r.merged_at, author: r.author_login, labels: [] }, ctx.env.GITHUB_REPO))
    .filter((m) => m.notable);
  const byArea = new Map<MergeArea, number>();
  for (const m of merges) byArea.set(m.area, (byArea.get(m.area) ?? 0) + 1);
  const highlights = merges.filter((m) => m.type === "feat").slice(0, HIGHLIGHTS);
  return { total: merges.length, byArea: [...byArea].sort((a, b) => b[1] - a[1] || AREA_LABEL[a[0]].localeCompare(AREA_LABEL[b[0]])), highlights };
}

const areaLine = (byArea: [MergeArea, number][]) => byArea.map(([area, n]) => `${AREA_LABEL[area]} ${n}`).join(" · ");
const highlightLines = (ctx: Ctx, highlights: { number: number; summary: string; library: string | null }[]) =>
  highlights.map((m) => `- [#${m.number}](https://github.com/${ctx.env.GITHUB_REPO}/pull/${m.number}) ${m.library ? `${m.library}: ` : ""}${m.summary.slice(0, 90)}`).join("\n");
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * A release announcement: its notes, downloads, and what was merged since the release before it. The site's data
 * still describes the previous release when this runs (the site rebuilds after), which gives the start of the span.
 */
export async function releaseMessage(ctx: Ctx, release: github.Release): Promise<Record<string, unknown>> {
  const base = baseUrl(ctx.env);
  const notes = (release.body ?? "").trim();
  const previous = (await siteData(ctx.env))?.release;
  const since = previous && previous.tag !== release.tag_name ? previous : null;
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  const asset = (pattern: RegExp) => release.assets?.find((a) => pattern.test(a.name));
  const downloads = [
    ["Linux", asset(/^relinker-v[\d.]+$/)],
    ["Windows", asset(/^relinker-v[\d.]+\.exe$/)],
  ] as const;
  const got = downloads.filter(([, a]) => a).map(([label, a]) => `[${label}](${a!.browser_download_url}) ${megabytes(a!.size)}`);
  fields.push({ name: "Get it", value: [`[Web converter](${base}/convert)`, ...got, `[Download page](${base}/download)`].join(" · ") });
  if (since) {
    const merged = await mergesBetween(ctx, since.published, release.published_at);
    if (merged.total) {
      fields.push({ name: `Since ${since.tag}`, value: `${merged.total} features, fixes and speed-ups\n${areaLine(merged.byArea)}`.slice(0, 1024) });
      if (merged.highlights.length) fields.push({ name: "New", value: highlightLines(ctx, merged.highlights).slice(0, 1024) });
    }
  }
  return {
    embeds: [
      {
        title: `AnyPS5 ${release.name || release.tag_name}`.slice(0, 256),
        url: release.html_url,
        description: (notes.length > 1500 ? `${notes.slice(0, 1500)}…` : notes) || undefined,
        color: 0x5b9bff,
        fields,
        timestamp: release.published_at,
      },
    ],
  };
}

/** What the weekly summary compares against: the same figures a week earlier. */
export interface WeekFigures {
  week: string;
  at: string;
  functions: number;
  decoded: number;
  tested: number;
  frames: number;
  gameplay: number;
}

export function weekFigures(data: SiteData, week: string, at: string): WeekFigures {
  const staged = data.games.filter((g) => g.stage && g.stage !== "Not converting");
  const count = (stages: string[]) => staged.filter((g) => stages.includes(g.stage!)).length;
  return {
    week,
    at,
    functions: data.libraries?.done ?? 0,
    decoded: data.shaders?.decoded ?? 0,
    tested: staged.length,
    frames: count(["Presents", "Menus", "Ingame", "Playable"]),
    gameplay: count(["Ingame", "Playable"]),
  };
}

/** Monday of the week a time falls in, as YYYY-MM-DD: the week's name. */
export const weekOf = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - ((at.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);

const change = (n: number) => (n > 0 ? `+${n.toLocaleString("en-GB")}` : n < 0 ? `−${Math.abs(n).toLocaleString("en-GB")}` : "no change");

/** The weekly summary, comparing this week's figures with last week's. */
export async function weekMessage(ctx: Ctx, data: SiteData, now: WeekFigures, before: WeekFigures, risen: string[]): Promise<Record<string, unknown>> {
  const base = baseUrl(ctx.env);
  const merged = await mergesBetween(ctx, before.at, now.at);
  const fields: { name: string; value: string }[] = [];
  if (data.libraries) fields.push({ name: "System libraries", value: `${change(now.functions - before.functions)} functions\n${meter(now.functions, data.libraries.total)}` });
  if (data.shaders) fields.push({ name: "Shader recompiler", value: `${change(now.decoded - before.decoded)} instructions decode\n${meter(now.decoded, data.shaders.total)}` });
  fields.push({
    name: "Games",
    value: `${now.tested} tested (${change(now.tested - before.tested)}) · ${now.frames} show frames (${change(now.frames - before.frames)}) · ${now.gameplay} reach gameplay (${change(now.gameplay - before.gameplay)})`,
  });
  if (risen.length) fields.push({ name: "Moved up", value: risen.slice(0, 10).join("\n").slice(0, 1024) });
  if (merged.total) fields.push({ name: "Merged", value: `${merged.total} features, fixes and speed-ups\n${areaLine(merged.byArea)}`.slice(0, 1024) });
  if (merged.highlights.length) fields.push({ name: "New", value: highlightLines(ctx, merged.highlights).slice(0, 1024) });
  if (data.release && data.release.published > before.at) fields.push({ name: "Released", value: `[AnyPS5 ${data.release.name || data.release.tag}](${data.release.url})` });
  return {
    embeds: [{ title: `AnyPS5 this week`, url: `${base}/progress`, description: `The week from <t:${Math.floor(Date.parse(before.at) / 1000)}:D>.`, color: 0x37e0c8, fields, timestamp: now.at }],
  };
}
