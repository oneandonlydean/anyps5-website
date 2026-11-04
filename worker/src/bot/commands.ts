import { now, type Env } from "./env";
import { findGames, link, links, meter, siteData, stageColor, words, type SiteData, type SiteGame } from "./site-data";

/**
 * The commands that answer from the site's data (src/pages/bot/data.json.ts): games, progress, the release, the
 * tracked games, the FAQ and rules, and following a game. /prs and /leaderboard, which answer from the merge history,
 * are in interactions.ts.
 */

const MESSAGE = 4;
const AUTOCOMPLETE_RESULT = 8;
const EPHEMERAL = 64;
/** No link previews under the message: for replies that are lists of links. */
const SUPPRESS_EMBEDS = 4;
/** Discord shows at most 25 suggestions. */
const SUGGESTIONS = 25;
const FOLLOWS_MAX = 25;
const WANTED_SHOWN = 10;

export interface Option {
  name: string;
  value: string;
  focused?: boolean;
}

// Mentions in replies render as names but never notify anyone.
export const reply = (data: Record<string, unknown>) => Response.json({ type: MESSAGE, data: { allowed_mentions: { parse: [] }, ...data } });
const privately = (content: string) => reply({ content, flags: EPHEMERAL });
const privateLinks = (content: string) => reply({ content, flags: EPHEMERAL | SUPPRESS_EMBEDS });
const unavailable = () => privately("The site's data isn't available right now. Try again in a minute.");

const when = (iso: string, style = "D") => `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const option = (options: Option[] | undefined, name: string) => options?.find((o) => o.name === name)?.value?.toString().trim() ?? "";

/** The game a command names: the slug autocomplete chose, or the best match for what was typed. */
const pickGame = (data: SiteData, query: string): SiteGame | undefined => data.games.find((g) => g.slug === query) ?? findGames(data, query)[0];
const noGame = (query: string) => privately(`No game on the compatibility list matches "${query.slice(0, 80)}".`);

function game(env: Env, data: SiteData, query: string): Response {
  const g = pickGame(data, query);
  if (!g) return noGame(query);
  const tested = g.tested
    ? `${when(g.tested.date)}${g.tested.build ? ` on ${g.tested.build}` : ""}${g.tested.releasesSince ? ` · ${g.tested.releasesSince} release${g.tested.releasesSince === 1 ? "" : "s"} ago` : ""}`
    : "Not yet";
  const fields = [
    { name: "Furthest stage", value: g.stage ?? "Untested", inline: true },
    { name: "Title ID", value: g.ids.join(", "), inline: true },
    { name: "Last tested", value: tested, inline: false },
  ];
  if (g.blockers.length) {
    fields.push({
      name: "Where it stops",
      value: g.blockers.map((b) => `${b.kind === "pr" ? "PR" : "Issue"} [#${b.number}](${b.url}) ${b.title.slice(0, 90)}`).join("\n"),
      inline: false,
    });
  }
  return reply({
    embeds: [
      {
        title: g.name,
        url: link(env, `/compatibility/${g.slug}`),
        color: stageColor(g.stage),
        // The game's share picture (cover, name and stage), drawn by the site build for every game.
        image: { url: `${link(env, `/og/${g.slug}.jpg`)}?v=${Date.parse(data.generated)}` },
        fields,
        footer: { text: "AnyPS5 compatibility list" },
      },
    ],
  });
}

const num = (n: number) => n.toLocaleString("en-GB");
const change = (n: number) => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : "±0");
const FRAMES = ["Presents", "Menus", "Ingame", "Playable"];
const GAMEPLAY = ["Ingame", "Playable"];
const atStages = (counts: Record<string, number | undefined>, stages: string[]) => stages.reduce((n, s) => n + (counts[s] ?? 0), 0);
const testedIn = (counts: Record<string, number | undefined>) => Object.entries(counts).reduce((n, [s, c]) => n + (s === "Not converting" ? 0 : (c ?? 0)), 0);
const STAGE_ORDER = ["Converts", "Loads", "Starts", "First draw", "Presents", "Menus", "Ingame", "Playable"];
const MILESTONE = { started: "first function", half: "reached half", complete: "complete" } as const;

/** /progress: everything at a glance, or one area in depth. */
async function progress(env: Env, data: SiteData, area: string): Promise<Response> {
  if (area === "libraries") return progressLibraries(env, data);
  if (area === "shaders") return progressShaders(env, data);
  if (area === "games") return progressGames(env, data);
  // The picture the site build draws (src/pages/bot/progress-card.jpg.ts); the text version if it's missing.
  if (await hasAsset(env, "/bot/progress-card.jpg")) {
    const now = data.stages.now;
    const parts = [
      data.libraries && `**${share(data.libraries.done, data.libraries.total)}** of library functions`,
      data.shaders && `**${share(data.shaders.decoded, data.shaders.total)}** of shader instructions`,
      `**${atStages(now, GAMEPLAY)}** of ${testedIn(now)} games reach gameplay`,
    ].filter(Boolean);
    return reply({
      embeds: [
        {
          title: "AnyPS5 progress",
          url: link(env, "/progress"),
          description: parts.join(" · "),
          // The build time in the address, so Discord fetches the new picture after each site update.
          image: { url: `${link(env, "/bot/progress-card.jpg")}?v=${Date.parse(data.generated)}` },
          color: 0x5b9bff,
          footer: { text: "/progress libraries, shaders or games for more" },
          timestamp: data.generated,
        },
      ],
    });
  }
  const fields = [];
  if (data.libraries) {
    const { done, total } = data.libraries;
    fields.push({ name: "System libraries", value: `${meter(done, total)}\n${num(done)} of ${num(total)} functions`, inline: false });
  }
  if (data.shaders) {
    const { decoded, translated, total } = data.shaders;
    fields.push({ name: "Shader recompiler", value: `${meter(decoded, total)}\n${decoded} of ${total} instructions decode; ${translated} also translate`, inline: false });
  }
  const now = data.stages.now;
  fields.push({
    name: "Games",
    value: `${testedIn(now)} tested · ${atStages(now, FRAMES)} show frames · ${atStages(now, GAMEPLAY)} reach gameplay · ${now.Playable ?? 0} playable`,
    inline: false,
  });
  return reply({
    embeds: [{ title: "AnyPS5 progress", url: link(env, "/progress"), color: 0x5b9bff, fields, footer: { text: "/progress libraries, shaders or games for more" }, timestamp: data.generated }],
  });
}

async function progressLibraries(env: Env, data: SiteData): Promise<Response> {
  const l = data.libraries;
  if (!l) return unavailable();
  const groups = l.groups.filter((g) => g.total > 0);
  const complete = groups.filter((g) => g.done === g.total);
  const started = groups.filter((g) => g.done > 0 && g.done < g.total);
  const biggest = [...groups].sort((a, b) => b.total - a.total).slice(0, 8);
  const nearly = started.filter((g) => g.done / g.total >= 0.8).sort((a, b) => b.done / b.total - a.done / a.total || b.total - a.total).slice(0, 6);
  const fields = [
    { name: "Functions", value: `${meter(l.done, l.total)}\n${num(l.done)} implemented of ${num(l.total)} declared`, inline: false },
    { name: "Libraries", value: `${complete.length} complete · ${started.length} started · ${groups.length - complete.length - started.length} not started · ${groups.length} in all`, inline: false },
    { name: "Biggest", value: biggest.map((g) => `\`${meter(g.done, g.total, 8)}\` ${g.name} · ${num(g.done)}/${num(g.total)}`).join("\n"), inline: false },
  ];
  if (nearly.length) fields.push({ name: "Nearly done", value: nearly.map((g) => `${g.name} · ${g.done}/${g.total}, ${g.total - g.done} to go`).join("\n"), inline: false });
  if (l.milestones.length) fields.push({ name: "Latest milestones", value: l.milestones.map((m) => `${m.library} ${MILESTONE[m.kind]} · ${when(m.date)}`).join("\n"), inline: false });
  const embed = { title: "System libraries", url: link(env, "/progress#libraries"), color: 0x5b9bff, fields, footer: { text: "/library <name> for one library" } };
  return withCard(env, data, "libraries", embed, (name) => ["Functions", "Libraries", "Biggest"].includes(name));
}

async function progressShaders(env: Env, data: SiteData): Promise<Response> {
  const sh = data.shaders;
  if (!sh) return unavailable();
  const f = sh.formats;
  const fields = [
    { name: "Instructions", value: `${meter(sh.decoded, sh.total)}\n${num(sh.decoded)} of ${num(sh.total)} decode · ${num(sh.translated)} also translate`, inline: false },
    { name: "DPP forms", value: `${meter(sh.dpp.decoded, sh.dpp.total)}\n${sh.dpp.decoded} of ${sh.dpp.total} decode`, inline: false },
    { name: "Image formats", value: `Sampled ${f.sampled}/${f.total} · Typed buffer ${f.buffer}/${f.total} · Vulkan host ${f.host}/${f.total}`, inline: false },
    { name: `Unsupported-throw sites (${sh.throws.total})`, value: sh.throws.areas.map((a) => `${a.name} · ${a.count}`).join("\n") || "None", inline: false },
  ];
  if (sh.untranslated.length) fields.push({ name: "Decoded, not yet translated", value: sh.untranslated.map((i) => `\`${i}\``).join(", ").slice(0, 1024), inline: false });
  const embed = { title: "Shader recompiler", url: link(env, "/progress#shaders"), color: 0x37e0c8, fields, footer: { text: "/progressmap for the full map" } };
  return withCard(env, data, "shaders", embed, (name) => name !== "Decoded, not yet translated");
}

async function progressGames(env: Env, data: SiteData): Promise<Response> {
  const { now, week, month } = data.stages;
  const top = Math.max(1, ...STAGE_ORDER.map((s) => now[s as keyof typeof now] ?? 0));
  const ladder = STAGE_ORDER.map((s) => {
    const n = now[s as keyof typeof now] ?? 0;
    return `\`${"▰".repeat(Math.round((n / top) * 10)).padEnd(10, "▱")}\` ${s} · ${n}`;
  });
  const none = now["Not converting"] ?? 0;
  const since = (then: typeof week, label: string) =>
    then.date
      ? `${label}: tested ${change(testedIn(now) - testedIn(then.counts))} · frames ${change(atStages(now, FRAMES) - atStages(then.counts, FRAMES))} · gameplay ${change(atStages(now, GAMEPLAY) - atStages(then.counts, GAMEPLAY))}`
      : null;
  const fields = [
    { name: "Furthest stage reached", value: `${ladder.join("\n")}${none ? `\nNot converting · ${none}` : ""}`, inline: false },
    { name: "Change", value: [since(week, "Last 7 days"), since(month, `Since ${month.date ? when(month.date) : "the start"}`)].filter(Boolean).join("\n") || "Not enough history yet", inline: false },
  ];
  const t = data.tracked;
  if (t?.games.length) {
    const run = t.games.filter((g) => g.stage).length;
    fields.push({ name: `Tracked games on ${t.release}`, value: `${t.games.filter((g) => g.stage && GAMEPLAY.includes(g.stage)).length} of ${t.games.length} reach gameplay · ${run} run so far · \`/tracked\` for the list`, inline: false });
  }
  const embed = { title: `${testedIn(now)} games tested, ${atStages(now, GAMEPLAY)} reach gameplay`, url: link(env, "/progress#games"), color: 0x2fcfa6, fields };
  return withCard(env, data, "games", embed, (name) => name === "Furthest stage reached");
}

/**
 * An in-depth /progress reply with the card the site build drew for it (src/pages/bot/cards/[area].jpg.ts): the
 * fields the card shows are left out, the rest stay as text. Without the card, the whole embed is text.
 */
async function withCard(env: Env, data: SiteData, area: string, embed: { fields: { name: string }[] } & Record<string, unknown>, drawn: (name: string) => boolean): Promise<Response> {
  if (!(await hasAsset(env, `/bot/cards/${area}.jpg`))) return reply({ embeds: [embed] });
  const fields = embed.fields.filter((f) => !drawn(f.name));
  return reply({
    embeds: [{ ...embed, fields: fields.length ? fields : undefined, image: { url: `${link(env, `/bot/cards/${area}.jpg`)}?v=${Date.parse(data.generated)}` }, timestamp: data.generated }],
  });
}

/** Whether the site build produced one of the bot's pictures. */
async function hasAsset(env: Env, path: string): Promise<boolean> {
  const res = env.ASSETS ? await env.ASSETS.fetch(link(env, path), { method: "HEAD" }) : null;
  await res?.body?.cancel();
  return Boolean(res?.ok);
}

/** A share as the meters show it: one decimal near either end. */
const share = (done: number, total: number) => meter(done, total, 0).trim();

/** Upstream's library map, rendered to PNG by the site build (src/pages/bot/[image].png.ts). */
async function progressMap(env: Env, data: SiteData): Promise<Response> {
  if (!(await hasAsset(env, "/bot/progress.png"))) return privately(`The map isn't available right now. Upstream has it at <${UPSTREAM_MAP}>.`);
  return reply({
    embeds: [
      {
        title: "AnyPS5 progress map",
        url: `https://github.com/${env.GITHUB_REPO}`,
        description: "Every system library function as a square (green: implemented), the shader recompiler's instruction forms, and what is still needed.",
        // The build time in the address, so Discord fetches the new picture after each site update.
        image: { url: `${link(env, "/bot/progress.png")}?v=${Date.parse(data.generated)}` },
        color: 0x2ea043,
        footer: { text: "From boykopovar.github.io/AnyPS5" },
        timestamp: data.generated,
      },
    ],
  });
}
const UPSTREAM_MAP = "https://boykopovar.github.io/AnyPS5/progress.svg";

const findLibrary = (data: SiteData, query: string) => {
  const q = words(query).replace(/^(lib)?(sce)?/, "");
  const groups = data.libraries?.groups ?? [];
  return groups.find((l) => words(l.name) === words(query)) ?? groups.find((l) => words(l.name).replace(/^(lib)?(sce)?/, "") === q) ?? groups.find((l) => words(l.name).includes(q));
};

function library(env: Env, data: SiteData, query: string): Response {
  const l = findLibrary(data, query);
  if (!l) return privately(`No system library matches "${query.slice(0, 80)}".`);
  const wanted = data.wanted.filter((w) => w.library === l.name);
  const fields = wanted.length
    ? [{ name: "Games are waiting on", value: wanted.map((w) => `\`${w.name}\` · ${w.games.length} game${w.games.length === 1 ? "" : "s"}`).join("\n"), inline: false }]
    : [];
  return reply({
    embeds: [
      {
        title: `${l.name} library`,
        url: link(env, "/progress#libraries"),
        description: `${meter(l.done, l.total)}\n${l.done} of ${l.total} functions implemented`,
        color: 0x5b9bff,
        fields,
      },
    ],
  });
}

function wanted(env: Env, data: SiteData): Response {
  if (!data.wanted.length) return privately("No game is waiting on a missing function right now.");
  const list = data.wanted.slice(0, WANTED_SHOWN).map((w, i) => {
    const games = w.games.length > 3 ? `${w.games.slice(0, 3).join(", ")} and ${w.games.length - 3} more` : w.games.join(", ");
    return `${i + 1}. \`${w.name}\` (${w.library}) · ${games}`;
  });
  return reply({
    embeds: [
      {
        title: "What games are waiting on",
        url: link(env, "/progress#wanted"),
        description: `Missing functions named in the most games' blockers.\n\n${list.join("\n")}`,
        color: 0xf5b84a,
      },
    ],
  });
}

function release(env: Env, data: SiteData): Response {
  const r = data.release;
  if (!r) return privately("No release is listed right now.");
  const d = r.downloads;
  const get = (label: string, a: { url: string; size: number } | null) => (a ? `[${label}](${a.url}) ${megabytes(a.size)}` : null);
  const downloads = [get("Linux", d.linux), get("Windows", d.windows)].filter(Boolean).join(" · ");
  const libraries = [get("Linux", d.librariesLinux), get("Windows", d.librariesWindows)].filter(Boolean).join(" · ");
  return reply({
    embeds: [
      {
        title: `AnyPS5 ${r.name || r.tag}`,
        url: r.url,
        description: `Released ${when(r.published, "R")}. Most people only need [the web converter](${link(env, "/convert")}), which includes everything.`,
        color: 0x5b9bff,
        fields: [
          ...(downloads ? [{ name: "Relinker", value: downloads, inline: false }] : []),
          ...(libraries ? [{ name: "System libraries", value: libraries, inline: false }] : []),
          { name: "More", value: `[Download page](${link(env, "/download")}) · [Release notes](${r.url})`, inline: false },
        ],
      },
    ],
  });
}

function tracked(env: Env, data: SiteData): Response {
  const t = data.tracked;
  if (!t?.games.length) return privately("No tracked games are set.");
  const run = t.games.filter((g) => g.stage);
  const waiting = t.games.filter((g) => !g.stage);
  const ingame = run.filter((g) => g.stage === "Ingame" || g.stage === "Playable").length;
  const fields = [];
  if (run.length) fields.push({ name: `Run on ${t.release}`, value: run.map((g) => `${g.stage} · ${g.name}`).join("\n").slice(0, 1024), inline: false });
  if (waiting.length) {
    fields.push({
      name: "Not run on it yet",
      value: waiting.map((g) => `${g.name}${g.ready ? " (what stopped it is fixed)" : ""}`).join("\n").slice(0, 1024),
      inline: false,
    });
  }
  return reply({
    embeds: [
      {
        title: `Tracked games on ${t.release}`,
        url: link(env, "/compatibility/tracked"),
        description: `${ingame} of ${t.games.length} reach gameplay; ${run.length} of ${t.games.length} have been run on it.`,
        color: 0x2fcfa6,
        fields,
      },
    ],
  });
}

function report(env: Env, data: SiteData, query: string): Response {
  const g = query ? pickGame(data, query) : undefined;
  if (query && !g) return noGame(query);
  const lines = g
    ? [
        `**${g.name}**`,
        `- Post how far it got in [its bring-up thread](${g.thread}).`,
        `- Or upload the \`anyps5-report.json\` AnyPS5 wrote when it stopped: [report page](${link(env, `/report?game=${g.slug}`)}).`,
      ]
    : [`- Post in [Game bring-up](https://github.com/${env.GITHUB_REPO}/discussions/categories/game-bring-up), one thread per game.`, `- Or upload the \`anyps5-report.json\` AnyPS5 wrote when it stopped: [report page](${link(env, "/report")}).`];
  return privateLinks(lines.join("\n"));
}

/** A FAQ answer: one of data/bot.yaml's (`a:topic`) or a question on the site's FAQ page (`q:q1-2`). */
function faq(env: Env, data: SiteData, query: string): Response {
  const [kind, id] = query.includes(":") ? query.split(":", 2) : ["", ""];
  const answer = kind === "a" ? data.answers.find((a) => a.topic === id) : undefined;
  const question = kind === "q" ? data.faq.find((f) => f.id === id) : undefined;
  const best = answer || question ? null : faqMatches(data, query)[0];
  const picked = answer ? { title: answer.title, text: answer.text, url: undefined } : question ? { title: question.q, text: question.a, url: `/faq#${question.id}` } : best;
  if (!picked) return privately(`Nothing in the FAQ matches "${query.slice(0, 80)}". The [FAQ page](${link(env, "/faq")}) has every question.`);
  return reply({
    embeds: [{ title: picked.title, url: picked.url ? link(env, picked.url) : undefined, description: links(env, picked.text).slice(0, 4000), color: 0x5b9bff }],
  });
}

function faqMatches(data: SiteData, query: string) {
  const q = words(query);
  const all = [
    ...data.answers.map((a) => ({ value: `a:${a.topic}`, title: a.title, text: a.text, url: undefined as string | undefined, keys: words(`${a.topic} ${a.title}`) })),
    ...data.faq.map((f) => ({ value: `q:${f.id}`, title: f.q, text: f.a, url: `/faq#${f.id}` as string | undefined, keys: words(f.q) })),
  ];
  return q ? all.filter((x) => q.split(" ").every((w) => x.keys.includes(w))) : all;
}

const NO_RULES = "The server rules aren't set yet. Maintainers add them in `data/bot.yaml`.";

function rules(env: Env, data: SiteData): Response {
  if (!data.rules) return privately(NO_RULES);
  return reply({ embeds: [{ title: "📜 AnyPS5 Server Rules", description: links(env, data.rules).slice(0, 4000), color: 0x5b9bff }] });
}

/** The numbered rules: paragraphs that start with a bold "N. Title". */
export function numberedRules(text: string | null): { number: number; title: string; text: string }[] {
  return (text ?? "").split(/\n\s*\n/).flatMap((p) => {
    const m = p.trim().match(/^\*\*(\d+)\.\s*([\s\S]+?)\*\*\s*([\s\S]*)$/);
    return m ? [{ number: Number(m[1]), title: m[2]!.trim(), text: m[3]!.trim() }] : [];
  });
}

/** /rule <number>: one rule, to point someone at it. */
function rule(env: Env, data: SiteData, number: string): Response {
  if (!data.rules) return privately(NO_RULES);
  const all = numberedRules(data.rules);
  const found = all.find((r) => r.number === Number(number));
  if (!found) return privately(`There's no rule ${number.slice(0, 10)}. The rules go from 1 to ${all.length}; \`/rules\` lists them.`);
  return reply({
    embeds: [{ title: `Rule ${found.number}: ${found.title}`, description: found.text ? links(env, found.text).slice(0, 4000) : undefined, color: 0x5b9bff, footer: { text: "/rules for all of them" } }],
  });
}

async function follow(env: Env, data: SiteData, caller: string, query: string): Promise<Response> {
  const g = pickGame(data, query);
  if (!g) return noGame(query);
  const count = (await env.DB.prepare("SELECT count(*) AS n FROM follows WHERE discord_id = ?").bind(caller).first<number>("n")) ?? 0;
  if (count >= FOLLOWS_MAX) return privately(`You follow ${FOLLOWS_MAX} games already. \`/unfollow\` one first.`);
  await env.DB.prepare("INSERT OR IGNORE INTO follows (discord_id, slug, created_at) VALUES (?, ?, ?)").bind(caller, g.slug, now()).run();
  return privately(
    `Following **${g.name}** (${g.stage ?? "untested"}). You'll get a direct message when it reaches a new stage. That needs direct messages from server members allowed; if one can't be delivered, you stop following.`,
  );
}

async function unfollow(env: Env, data: SiteData, caller: string, query: string): Promise<Response> {
  const g = pickGame(data, query);
  const slug = g?.slug ?? query;
  const { meta } = await env.DB.prepare("DELETE FROM follows WHERE discord_id = ? AND slug = ?").bind(caller, slug).run();
  return privately(meta.changes ? `Stopped following **${g?.name ?? slug}**.` : `You weren't following ${g ? `**${g.name}**` : `"${query.slice(0, 80)}"`}.`);
}

async function following(env: Env, data: SiteData, caller: string): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT slug FROM follows WHERE discord_id = ? ORDER BY created_at").bind(caller).all<{ slug: string }>();
  if (!results.length) return privately("You don't follow any games. `/follow` one to hear when it moves up.");
  const bySlug = new Map(data.games.map((g) => [g.slug, g]));
  const list = results.map(({ slug }) => {
    const g = bySlug.get(slug);
    return g ? `- [${g.name}](${link(env, `/compatibility/${slug}`)}) · ${g.stage ?? "untested"}` : `- ${slug} (no longer listed)`;
  });
  return privateLinks(`You follow:\n${list.join("\n")}`);
}

const SITE_COMMANDS = new Set(["game", "progress", "progressmap", "library", "wanted", "release", "tracked", "report", "faq", "rules", "rule", "follow", "unfollow", "following"]);
export const isSiteCommand = (name: string) => SITE_COMMANDS.has(name);

export async function runSiteCommand(env: Env, name: string, options: Option[] | undefined, caller: string): Promise<Response> {
  const data = await siteData(env);
  if (!data) return unavailable();
  const arg = (n: string) => option(options, n);
  switch (name) {
    case "game":
      return game(env, data, arg("name"));
    case "progress":
      return progress(env, data, arg("area"));
    case "progressmap":
      return progressMap(env, data);
    case "library":
      return library(env, data, arg("name"));
    case "wanted":
      return wanted(env, data);
    case "release":
      return release(env, data);
    case "tracked":
      return tracked(env, data);
    case "report":
      return report(env, data, arg("game"));
    case "faq":
      return faq(env, data, arg("topic"));
    case "rules":
      return rules(env, data);
    case "rule":
      return rule(env, data, arg("number"));
    case "follow":
      return follow(env, data, caller, arg("game"));
    case "unfollow":
      return unfollow(env, data, caller, arg("game"));
    default:
      return following(env, data, caller);
  }
}

/** Suggestions as people type: games, libraries or FAQ topics. */
export async function suggest(env: Env, name: string, options: Option[] | undefined, caller: string | undefined): Promise<Response> {
  const data = await siteData(env);
  const focused = options?.find((o) => o.focused);
  const typed = focused?.value?.toString() ?? "";
  let choices: { name: string; value: string }[] = [];
  if (data && focused) {
    if (focused.name === "game" || focused.name === "name") {
      if (name === "library") {
        const q = words(typed);
        choices = (data.libraries?.groups ?? [])
          .filter((l) => !q || words(l.name).includes(q))
          .sort((a, b) => b.total - a.total)
          .map((l) => ({ name: `${l.name} · ${l.done}/${l.total}`, value: l.name }));
      } else if (name === "unfollow" && caller) {
        const { results } = await env.DB.prepare("SELECT slug FROM follows WHERE discord_id = ?").bind(caller).all<{ slug: string }>();
        const followed = new Set(results.map((r) => r.slug));
        choices = findGames(data, typed)
          .filter((g) => followed.has(g.slug))
          .map((g) => ({ name: g.name, value: g.slug }));
      } else {
        choices = findGames(data, typed).map((g) => ({ name: `${g.name} · ${g.stage ?? "untested"}`, value: g.slug }));
      }
    } else if (focused.name === "topic") {
      choices = faqMatches(data, typed).map((x) => ({ name: x.title, value: x.value }));
    } else if (focused.name === "number") {
      const q = words(typed);
      // An integer option: the suggestion's value is the number itself.
      return Response.json({
        type: AUTOCOMPLETE_RESULT,
        data: {
          choices: numberedRules(data.rules)
            .filter((r) => !q || String(r.number).startsWith(q) || words(r.title).includes(q))
            .slice(0, SUGGESTIONS)
            .map((r) => ({ name: `${r.number}. ${r.title}`.slice(0, 100), value: r.number })),
        },
      });
    }
  }
  return Response.json({ type: AUTOCOMPLETE_RESULT, data: { choices: choices.slice(0, SUGGESTIONS).map((c) => ({ name: c.name.slice(0, 100), value: c.value.slice(0, 100) })) } });
}
