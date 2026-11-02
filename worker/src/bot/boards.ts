import { reply } from "./commands";
import type { Env } from "./env";
import { link, meter, siteData, type SiteData } from "./site-data";

/**
 * /leaderboard (contributors from the merge history, testers from the site's reports) and /stats, the project in
 * numbers. Linked members are shown with their Discord name; mentions never notify anyone.
 */

const SIZE = 10;
const DAY = 864e5;
const MEDALS = ["🥇", "🥈", "🥉"];
const PERIOD = { all: "All time", month: "Last 30 days", week: "Last 7 days" } as const;
type Period = keyof typeof PERIOD;

const num = (n: number) => n.toLocaleString("en-GB");
const rank = (i: number) => MEDALS[i] ?? `\`${String(i + 1).padStart(2)}.\``;
const github = (login: string) => `[${login}](<https://github.com/${login}>)`;
const who = (login: string, discordId: string | null | undefined) => `**${github(login)}**${discordId ? ` <@${discordId}>` : ""}`;
const sinceIso = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 19) + "Z";

/** The three counts on a line, the ranked one first and bold. */
function counts(c: Record<Period, number>, ranked: Period, noun: string): string {
  const label = { all: noun, month: "this month", week: "this week" };
  const order: Period[] = [ranked, ...(["all", "month", "week"] as Period[]).filter((p) => p !== ranked)];
  return order.map((p, i) => (i === 0 ? `**${num(c[p])}** ${label[p]}` : `${num(c[p])} ${label[p]}`)).join(" · ");
}

interface ContributorRow {
  login: string;
  discord_id: string | null;
  total: number;
  month: number;
  week: number;
}

/** Merge totals, excluding bots: every merge, the last 30 and 7 days, and how many people made them. */
async function mergeTotals(env: Env) {
  return (await env.DB.prepare(
    `SELECT count(*) AS total, coalesce(sum(merged_at >= ?1), 0) AS month, coalesce(sum(merged_at >= ?2), 0) AS week,
            count(DISTINCT author_id) AS people, count(DISTINCT CASE WHEN merged_at >= ?1 THEN author_id END) AS active
     FROM merges WHERE author_login NOT LIKE '%[bot]'`,
  )
    .bind(sinceIso(30), sinceIso(7))
    .first<{ total: number; month: number; week: number; people: number; active: number }>())!;
}

async function contributors(env: Env, period: Period): Promise<Response> {
  const order = { all: "total", month: "month", week: "week" }[period];
  // The newest login per account, as accounts can be renamed.
  const { results } = await env.DB.prepare(
    `SELECT (SELECT author_login FROM merges n WHERE n.author_id = m.author_id ORDER BY merged_at DESC LIMIT 1) AS login,
            u.discord_id, count(*) AS total, sum(m.merged_at >= ?1) AS month, sum(m.merged_at >= ?2) AS week, max(m.merged_at) AS latest
     FROM merges m LEFT JOIN users u ON u.github_id = m.author_id
     WHERE m.author_id IS NOT NULL AND m.author_login NOT LIKE '%[bot]'
     GROUP BY m.author_id HAVING ${order} > 0 ORDER BY ${order} DESC, total DESC, latest DESC LIMIT ?3`,
  )
    .bind(sinceIso(30), sinceIso(7), SIZE)
    .all<ContributorRow>();
  const t = await mergeTotals(env);
  if (!results.length) return reply({ content: `No merged pull requests ${period === "all" ? "yet" : `in the ${PERIOD[period].toLowerCase()}`}.` });
  const lines = results.map((r, i) => `${rank(i)} ${who(r.login, r.discord_id)}\n${counts({ all: r.total, month: r.month, week: r.week }, period, "merged")}`);
  return reply({
    embeds: [
      {
        title: `Top contributors · ${PERIOD[period]}`,
        url: `https://github.com/${env.GITHUB_REPO}/graphs/contributors`,
        description: `**${num(t.total)}** merged · **${num(t.month)}** in 30 days · **${num(t.week)}** in 7 days · ${num(t.people)} contributors, ${num(t.active)} active this month\n\n${lines.join("\n")}`,
        color: 0x8250df,
        footer: { text: `${env.GITHUB_REPO} · /leaderboard testers for testers` },
      },
    ],
  });
}

/** Discord accounts linked to these GitHub logins. */
async function linked(env: Env, logins: string[]): Promise<Map<string, string>> {
  if (!logins.length) return new Map();
  const { results } = await env.DB.prepare(`SELECT lower(github_login) AS login, discord_id FROM users WHERE lower(github_login) IN (${logins.map(() => "?").join(", ")})`)
    .bind(...logins.map((l) => l.toLowerCase()))
    .all<{ login: string; discord_id: string }>();
  return new Map(results.map((r) => [r.login, r.discord_id]));
}

async function testers(env: Env, data: SiteData, period: Period): Promise<Response> {
  const { totals, people } = data.testers;
  const value = (p: (typeof people)[number]) => (period === "all" ? p.reports + p.uploads : p[period]);
  const top = people.filter((p) => value(p) > 0).sort((a, b) => value(b) - value(a) || b.games - a.games || b.last.localeCompare(a.last)).slice(0, SIZE);
  if (!top.length) return reply({ content: `No test reports ${period === "all" ? "yet" : `in the ${PERIOD[period].toLowerCase()}`}.` });
  const discord = await linked(env, top.map((p) => p.login));
  const lines = top.map((p, i) => {
    const line = counts({ all: p.reports + p.uploads, month: p.month, week: p.week }, period, "reports");
    return `${rank(i)} ${who(p.login, discord.get(p.login.toLowerCase()))}\n${line} · ${p.games} game${p.games === 1 ? "" : "s"}`;
  });
  return reply({
    embeds: [
      {
        title: `Top testers · ${PERIOD[period]}`,
        url: link(env, "/compatibility"),
        description: `**${num(totals.reports + totals.uploads)}** reports${totals.uploads ? ` (${num(totals.uploads)} uploaded)` : ""} · **${num(totals.month)}** in 30 days · **${num(totals.week)}** in 7 days · ${num(totals.testers)} testers\n\n${lines.join("\n")}`,
        color: 0x2fcfa6,
        footer: { text: "Bring-up reports and uploaded run reports · /report to add yours" },
      },
    ],
  });
}

export async function leaderboard(env: Env, board: string, periodKey: string): Promise<Response> {
  const period: Period = periodKey in PERIOD ? (periodKey as Period) : "all";
  if (board !== "testers") return contributors(env, period);
  const data = await siteData(env);
  if (!data) return reply({ content: "The site's data isn't available right now. Try again in a minute.", flags: 64 });
  return testers(env, data, period);
}

/** /stats: the project in numbers. */
export async function stats(env: Env): Promise<Response> {
  const [data, t, members] = await Promise.all([
    siteData(env),
    mergeTotals(env),
    env.DB.prepare("SELECT count(*) AS n FROM users WHERE github_id IS NOT NULL").first<number>("n"),
  ]);
  const fields = [
    { name: "Merged pull requests", value: `**${num(t.total)}** in all\n${num(t.month)} in 30 days · ${num(t.week)} in 7 days`, inline: true },
    { name: "Contributors", value: `**${num(t.people)}** in all\n${num(t.active)} active this month · ${num(members ?? 0)} linked here`, inline: true },
  ];
  if (data?.libraries) {
    const groups = data.libraries.groups.filter((g) => g.total > 0);
    const complete = groups.filter((g) => g.done === g.total).length;
    const started = groups.filter((g) => g.done > 0 && g.done < g.total).length;
    fields.push({
      name: "System libraries",
      value: `${meter(data.libraries.done, data.libraries.total, 10)}\n${num(data.libraries.done)} implemented of ${num(data.libraries.total)} declared functions\n${complete} of ${groups.length} libraries complete, ${started} started`,
      inline: false,
    });
  }
  if (data?.shaders) {
    fields.push({ name: "Shader recompiler", value: `${meter(data.shaders.decoded, data.shaders.total, 10)}\n${num(data.shaders.decoded)} of ${num(data.shaders.total)} instructions decode`, inline: false });
  }
  if (data) {
    const now = data.stages.now;
    const tested = Object.entries(now).reduce((n, [s, c]) => n + (s === "Not converting" ? 0 : (c ?? 0)), 0);
    const gameplay = (now.Ingame ?? 0) + (now.Playable ?? 0);
    fields.push({ name: "Games", value: `**${num(data.games.length)}** listed\n${num(tested)} tested · ${num(gameplay)} reach gameplay · ${num(now.Playable ?? 0)} playable`, inline: true });
    const tt = data.testers.totals;
    fields.push({ name: "Testing", value: `**${num(tt.reports + tt.uploads)}** reports\n${num(tt.testers)} testers · ${num(tt.month)} reports in 30 days`, inline: true });
    if (data.release) fields.push({ name: "Latest release", value: `[${data.release.name || data.release.tag}](${data.release.url}) · <t:${Math.floor(Date.parse(data.release.published) / 1000)}:R>`, inline: false });
  }
  return reply({ embeds: [{ title: "AnyPS5 in numbers", url: link(env, "/progress"), color: 0x5b9bff, fields, timestamp: data?.generated }] });
}
