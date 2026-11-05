import { stageRank, type StageOrNone } from "../../../src/lib/stages";
import { reply } from "./commands";
import type { Env } from "./env";
import { lookup, search } from "./lookup";
import { findGames, link, stageColor, type SiteData } from "./site-data";

/**
 * /recent, /error, /setup, /games, /screenshot and /profile: what changed lately, what an error or a missing function
 * means, the setup guide in short, games by stage and system, community screenshots, and one person's contributions and
 * test reports.
 */

const EPHEMERAL = 64;
const privately = (content: string) => reply({ content, flags: EPHEMERAL });
const when = (iso: string, style = "R") => `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;
const num = (n: number) => n.toLocaleString("en-GB");
const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
const DAY = 864e5;
/** Discord's limit for one embed field. */
const FIELD = 1024;

/** Lines joined up to a field's limit, saying how many were left out. */
function fit(lines: string[], limit = FIELD): string {
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    const more = lines.length - i;
    const tail = `\n…and ${more} more`;
    if ([...out, line].join("\n").length + (more > 1 ? tail.length : 0) > limit) return `${out.join("\n")}${tail}`;
    out.push(line);
  }
  return out.join("\n");
}

/** Text cut at a line break before Discord's field limit. */
function clip(text: string, limit = FIELD): string {
  if (text.length <= limit) return text;
  let cut = text.slice(0, limit - 8);
  cut = cut.slice(0, Math.max(cut.lastIndexOf("\n"), limit / 2));
  // A code block cut open is closed again, or the rest of the message would read as code.
  if ((cut.match(/```/g) ?? []).length % 2) cut += "\n```";
  return `${cut}\n…`;
}

const gameLinks = (env: Env, data: SiteData, slugs: string[], shown = 6) => {
  const names = new Map(data.games.map((g) => [g.slug, g.name]));
  const listed = slugs.slice(0, shown).map((s) => `[${names.get(s) ?? s}](${link(env, `/compatibility/${s}`)})`);
  return `${listed.join(", ")}${slugs.length > shown ? ` and ${slugs.length - shown} more` : ""}`;
};

// ---- /recent ----

const ICON: Record<string, string> = { stage: "⬆️", regression: "⬇️", release: "🚀", retest: "🔁", digest: "🛠️", week: "📅", library: "📚" };
const RECENT_PERIOD = { day: { days: 1, label: "Last 24 hours" }, week: { days: 7, label: "Last 7 days" }, month: { days: 30, label: "Last 30 days" } } as const;
const AREAS = [
  ["games", "Games"],
  ["releases", "Releases"],
  ["progress", "Progress"],
] as const;

export function recent(env: Env, data: SiteData, period: string, area: string): Response {
  const p = RECENT_PERIOD[period as keyof typeof RECENT_PERIOD] ?? RECENT_PERIOD.week;
  const since = Date.now() - p.days * DAY;
  const items = data.recent.filter((u) => Date.parse(u.date) >= since && (!area || area === "all" || u.category === area));
  if (!items.length) return reply({ content: `Nothing new in the ${p.label.toLowerCase()}${area && area !== "all" ? ` for ${area}` : ""}. [Updates](${link(env, "/updates")}) has everything.` });
  const line = (u: (typeof items)[number]) => `${ICON[u.kind] ?? "•"} [${u.title.slice(0, 120)}](${link(env, u.url)}) · ${when(u.date)}`;
  const fields = AREAS.map(([key, name]) => ({ key, name, list: items.filter((u) => u.category === key) }))
    .filter((f) => f.list.length)
    .map((f) => ({ name: `${f.name} · ${f.list.length}`, value: fit(f.list.map(line)), inline: false }));
  return reply({
    embeds: [
      {
        title: `What's new · ${p.label}`,
        url: link(env, "/updates"),
        color: 0x5b9bff,
        fields,
        footer: { text: "Stage changes, releases and progress · /follow a game to hear when it moves" },
      },
    ],
  });
}

// ---- /error ----

const STATUS = { implemented: "✅ Implemented on main", missing: "❌ Not implemented on main yet", undeclared: "❌ Not declared on main yet" } as const;

export async function error(env: Env, data: SiteData, text: string): Promise<Response> {
  if (text.length < 4) return privately("Paste the error line, or type a function name like `sceHttp2SendRequest`.");
  const l = await lookup(env);
  if (!l) return privately("The lookup isn't available right now. Try again in a minute.");
  const { functions, errors } = search(l, text);
  if (!functions.length && !errors.length) {
    return privately(
      `Nothing in today's source matches "${text.slice(0, 120)}". Paste the line as the game printed it. An error that has been fixed or reworded may no longer be in the source; [Fix common problems](${link(env, "/docs/guide/troubleshooting")}) covers the usual ones.`,
    );
  }
  const source = (file: string, line: number) => `https://github.com/${env.GITHUB_REPO}/blob/${l.commit}/${file}#L${line}`;
  const fields = [
    ...functions.map((f) => {
      const games = l.named.functions[f.name] ?? [];
      return {
        name: `${f.name} · ${f.library}`.slice(0, 256),
        value: clip(
          [
            STATUS[f.status],
            `[${f.library} on the progress map](${link(env, `/progress?library=${encodeURIComponent(f.library)}#libraries`)})`,
            games.length ? `Named by ${plural(games.length, "game")}: ${gameLinks(env, data, games)}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        inline: false,
      };
    }),
    ...errors.map((e) => {
      const games = l.named.errors[e.message] ?? [];
      const [first, ...others] = e.sites;
      return {
        name: `Error: ${e.message}`.slice(0, 256),
        value: clip(
          [
            `Still in today's source, at [${first!.file.split("/").pop()}:${first!.line}](${source(first!.file, first!.line)})${others.length ? ` and ${plural(others.length, "other place")}` : ""}.`,
            games.length ? `Games stopped by it: ${gameLinks(env, data, games)}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        inline: false,
      };
    }),
  ];
  return reply({
    embeds: [
      {
        title: "What that means",
        description: `Checked against AnyPS5's source at [\`${l.commit.slice(0, 7)}\`](https://github.com/${env.GITHUB_REPO}/commit/${l.commit}).`,
        color: 0xf6a23a,
        fields,
        footer: { text: "/wanted for what most games wait on · /setup troubleshooting for common fixes" },
      },
    ],
  });
}

// ---- /setup ----

export function setup(env: Env, data: SiteData, step: string): Response {
  const steps = data.guide;
  if (!steps.length) return privately(`The [setup guide](${link(env, "/docs/guide")}) has every step.`);
  const picked = steps.find((s) => s.slug === step || String(s.step) === step);
  if (!picked) {
    return reply({
      embeds: [
        {
          title: "Setting up AnyPS5",
          url: link(env, "/docs/guide"),
          description: "Six steps from a game you own to playing it on your PC. `/setup <step>` shows one in more detail.",
          color: 0x5b9bff,
          fields: steps.map((s) => ({ name: `${s.step}. ${s.title}`, value: `${s.summary} [Read it](${link(env, `/docs/guide/${s.slug}`)})`, inline: false })),
        },
      ],
    });
  }
  const url = link(env, `/docs/guide/${picked.slug}`);
  // Site links in the guide are paths; Discord needs the full address.
  const full = (text: string) => text.replace(/\]\(\//g, `](${link(env, "/")}`);
  const fields = picked.sections
    .filter((s) => s.text)
    .map((s) => ({ name: s.heading, value: clip(`${full(s.text)}\n[More](${url}#${s.anchor})`), inline: false }));
  // An embed holds 6,000 characters in all: later sections give way to a link.
  while (fields.reduce((n, f) => n + f.name.length + f.value.length, 0) > 5200) fields.pop();
  const next = steps.find((s) => s.step === picked.step + 1);
  return reply({
    embeds: [
      {
        title: `Step ${picked.step}: ${picked.title}`,
        url,
        description: picked.summary,
        color: 0x5b9bff,
        fields,
        footer: { text: next ? `Next: /setup ${next.slug} · ${next.title}` : "That's the last step · /report to share how far a game got" },
      },
    ],
  });
}

// ---- /games ----

const SHOWN = 35;
const OS_NAME: Record<string, string> = { linux: "Linux", windows: "Windows", macos: "macOS" };

export function games(env: Env, data: SiteData, stage: string, gpu: string, os: string): Response {
  const minimum = stageRank(stage as StageOrNone);
  if (minimum < 0) return privately("Pick a stage from the list.");
  const filtered = Boolean(gpu || os);
  const matches = (key: string) => {
    const [o, g] = key.split("/");
    return (!os || o === os) && (!gpu || g!.toLowerCase() === gpu.toLowerCase());
  };
  const reached = data.games
    .map((g) => {
      // On a system: the furthest any report on it got. Otherwise the game's stage on the list.
      const on = filtered
        ? Object.entries(g.systems ?? {})
            .filter(([key]) => matches(key))
            .reduce<StageOrNone | null>((top, [, s]) => (stageRank(s) > stageRank(top) ? s : top), null)
        : g.stage;
      return { g, on };
    })
    .filter((x) => x.on && stageRank(x.on) >= minimum)
    .sort((a, b) => stageRank(b.on) - stageRank(a.on) || a.g.name.localeCompare(b.g.name));
  const system = [os && (OS_NAME[os] ?? os), gpu].filter(Boolean).join(" · ");
  const title = `${stage}${stage === "Playable" ? "" : " or further"}${system ? ` on ${system}` : ""}`;
  if (!reached.length) return reply({ content: `No games reach ${title.toLowerCase()} yet.` });
  const lines = reached.slice(0, SHOWN).map(({ g, on }) => `[${g.name}](${link(env, `/compatibility/${g.slug}`)}) · ${on}`);
  return reply({
    embeds: [
      {
        title: `${plural(reached.length, "game")}: ${title}`,
        url: link(env, "/compatibility"),
        description: `${lines.join("\n")}${reached.length > SHOWN ? `\n…and ${reached.length - SHOWN} more on the [compatibility list](${link(env, "/compatibility")})` : ""}`,
        color: stageColor(stage as StageOrNone),
        footer: { text: filtered ? "From test reports on that system · /game for one game" : "Each game's stage on the compatibility list · /game for one game" },
      },
    ],
  });
}

// ---- /screenshot ----

export function screenshot(env: Env, data: SiteData, query: string): Response {
  const g = query ? (data.games.find((x) => x.slug === query) ?? findGames(data, query)[0]) : undefined;
  if (query && !g) return privately(`No game on the compatibility list matches "${query.slice(0, 80)}".`);
  const pool = g ? data.screenshots.filter((s) => s.slug === g.slug) : data.screenshots;
  if (!pool.length) return privately(g ? `No screenshots of **${g.name}** yet. Testers post them with their reports.` : "No screenshots yet.");
  const shot = pool[Math.floor(Math.random() * pool.length)]!;
  const game = g ?? data.games.find((x) => x.slug === shot.slug);
  return reply({
    embeds: [
      {
        title: game?.name ?? shot.slug,
        url: link(env, `/compatibility/${shot.slug}`),
        description: [shot.author ? `Captured by **${shot.author}**` : null, `[See the post](${shot.url})`, shot.stage ? `reported ${shot.stage}` : null].filter(Boolean).join(" · "),
        image: { url: link(env, shot.image) },
        color: stageColor(game?.stage ?? null),
        footer: { text: `${plural(pool.length, "screenshot")}${g ? ` of ${g.name}` : ""} · /screenshot again for another` },
        timestamp: shot.date,
      },
    ],
  });
}

/** Games with screenshots, for autocomplete. */
export const withScreenshots = (data: SiteData) => new Set(data.screenshots.map((s) => s.slug));

// ---- /profile ----

const sinceIso = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 19) + "Z";

/**
 * /profile: one person's merged pull requests and test reports, with where they rank. Found by their linked Discord
 * account, or by a GitHub login for people who aren't linked or aren't on the server.
 */
export async function profile(env: Env, data: SiteData | null, caller: string, member: string, login: string): Promise<Response> {
  const target = member || caller;
  let github = login.replace(/^@/, "").trim();
  let githubId: number | null = null;
  if (!github) {
    const user = await env.DB.prepare("SELECT github_id, github_login FROM users WHERE discord_id = ? AND github_id IS NOT NULL")
      .bind(target)
      .first<{ github_id: number; github_login: string }>();
    if (!user) {
      return privately(
        target === caller
          ? "You haven't linked a GitHub account yet. Open the server menu, choose **Linked Roles**, and connect. Or look anyone up with `/profile github:<login>`."
          : `<@${target}> hasn't linked a GitHub account. \`/profile github:<login>\` looks up anyone.`,
      );
    }
    github = user.github_login;
    githubId = user.github_id;
  }
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(github)) return privately("That isn't a GitHub login.");
  githubId ??= (await env.DB.prepare("SELECT author_id FROM merges WHERE lower(author_login) = lower(?) AND author_id IS NOT NULL ORDER BY merged_at DESC LIMIT 1").bind(github).first<number>("author_id")) ?? null;

  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (githubId !== null) {
    const mine = (await env.DB.prepare(
      "SELECT count(*) AS total, coalesce(sum(merged_at >= ?2), 0) AS month, coalesce(sum(merged_at >= ?3), 0) AS week FROM merges WHERE author_id = ?1",
    )
      .bind(githubId, sinceIso(30), sinceIso(7))
      .first<{ total: number; month: number; week: number }>())!;
    if (mine.total) {
      const ahead = (await env.DB.prepare(
        "SELECT count(*) AS n FROM (SELECT author_id FROM merges WHERE author_id IS NOT NULL AND author_login NOT LIKE '%[bot]' GROUP BY author_id HAVING count(*) > ?)",
      )
        .bind(mine.total)
        .first<number>("n"))!;
      const people = (await env.DB.prepare("SELECT count(DISTINCT author_id) AS n FROM merges WHERE author_login NOT LIKE '%[bot]'").first<number>("n"))!;
      const { results: latest } = await env.DB.prepare("SELECT number, title, merged_at FROM merges WHERE author_id = ? ORDER BY merged_at DESC LIMIT 3")
        .bind(githubId)
        .all<{ number: number; title: string; merged_at: string }>();
      const list = `https://github.com/${env.GITHUB_REPO}/pulls?q=${encodeURIComponent(`is:pr is:merged author:${github}`)}`;
      fields.push({
        name: "Contributions",
        value: clip(
          [
            `**[${plural(mine.total, "merged pull request")}](<${list}>)** · #${ahead + 1} of ${num(people)} contributors`,
            `${num(mine.month)} in the last 30 days · ${num(mine.week)} in the last 7`,
            ...latest.map((m) => `- [#${m.number}](<https://github.com/${env.GITHUB_REPO}/pull/${m.number}>) ${m.title.slice(0, 80)} · ${when(m.merged_at)}`),
          ].join("\n"),
        ),
        inline: false,
      });
    }
  }
  const people = data?.testers.people ?? [];
  const at = people.findIndex((p) => p.login.toLowerCase() === github.toLowerCase());
  if (at >= 0) {
    const p = people[at]!;
    const total = p.reports + p.uploads;
    // people is sorted by reports, most first: ties share the better rank.
    const rank = people.findIndex((q) => q.reports + q.uploads === total) + 1;
    fields.push({
      name: "Testing",
      value: [
        `**${plural(total, "report")}**${p.uploads ? ` (${num(p.uploads)} uploaded)` : ""} on ${plural(p.games, "game")} · #${rank} of ${num(people.length)} testers`,
        `${num(p.month)} in the last 30 days · last one ${when(p.last)}`,
      ].join("\n"),
      inline: false,
    });
  }
  if (!fields.length) return privately(`No merged pull requests or test reports from **${github}** yet.`);
  return reply({
    embeds: [
      {
        title: github,
        url: `https://github.com/${github}`,
        description: !login && target ? `<@${target}>` : undefined,
        thumbnail: { url: `https://github.com/${github}.png?size=160` },
        color: 0x8250df,
        fields,
        footer: { text: "/leaderboard to see everyone" },
      },
    ],
  });
}
