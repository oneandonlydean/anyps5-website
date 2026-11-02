import { AREA_LABEL, classify, typeLabel, type ClassifiedMerge, type MergeArea } from "../../../src/lib/merges";
import * as discord from "./discord";
import { baseUrl, log, type Ctx, type Env } from "./env";
import * as github from "./github";
import { siteData } from "./site-data";
import { releaseMessage, weekFigures, weekMessage, weekOf, type WeekFigures } from "./summaries";

/**
 * What the bot posts, and where. Merges are sorted with the site's own classifier, so Discord and /updates agree on
 * what counts as progress: features, fixes and speed-ups go to the progress channel, everything else to the dev
 * channel if one is set. Releases and game stage rises have channels of their own.
 */

const AREA_COLOR: Record<MergeArea, number> = {
  libraries: 0x5b9bff,
  gpu: 0xf5b84a,
  shader: 0x37e0c8,
  relinker: 0xc084fc,
  converter: 0x3ddc84,
  project: 0x8e98ab,
};

export const classifyPull = (pr: github.Pull, env: Env): ClassifiedMerge =>
  classify({ number: pr.number, title: pr.title, mergedAt: pr.merged_at, author: pr.user?.login ?? null, labels: pr.labels }, env.GITHUB_REPO);

/** The webhook a merge goes to, or undefined when it is not announced. */
export function mergeWebhook(env: Env, merge: ClassifiedMerge): string | undefined {
  return merge.notable ? env.DISCORD_WEBHOOK_PROGRESS || env.DISCORD_WEBHOOK_URL : env.DISCORD_WEBHOOK_DEV || undefined;
}

/** A merge announcement. A linked author is pinged; nobody else can be, whatever the title contains. */
export function mergeMessage(env: Env, pr: github.Pull, merge: ClassifiedMerge, discordId: string | undefined): Record<string, unknown> {
  const files = `${pr.changed_files} file${pr.changed_files === 1 ? "" : "s"}`;
  const fields = [
    { name: "Area", value: merge.library ? `${AREA_LABEL[merge.area]} · ${merge.library}` : AREA_LABEL[merge.area], inline: true },
    { name: "Type", value: typeLabel(merge.type), inline: true },
    { name: "Changes", value: `+${pr.additions} −${pr.deletions} in ${files}`, inline: true },
  ];
  if (merge.titleIds.length) {
    const games = merge.titleIds.map((id) => `[${id}](${baseUrl(env)}/compatibility/?q=${id})`).join(", ");
    fields.push({ name: "Games", value: games.slice(0, 1024), inline: false });
  }
  return {
    content: discordId ? `<@${discordId}>` : undefined,
    embeds: [
      {
        author: pr.user ? { name: pr.user.login, url: pr.user.html_url, icon_url: pr.user.avatar_url } : undefined,
        title: `#${pr.number} ${merge.library ?? AREA_LABEL[merge.area]}: ${merge.summary}`.slice(0, 256),
        url: pr.html_url,
        description: pr.merged_by ? `Merged by ${pr.merged_by}` : undefined,
        color: AREA_COLOR[merge.area],
        fields,
        timestamp: pr.merged_at,
      },
    ],
    allowed_mentions: discordId ? { users: [discordId] } : { parse: [] },
  };
}

const kvGet = (ctx: Ctx, key: string) => ctx.env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first<string>("value");
const kvSet = (ctx: Ctx, key: string, value: string) =>
  ctx.env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();

/** Posts the newest release once. The first run only records it, so an old release is never announced. */
export async function announceReleases(ctx: Ctx): Promise<void> {
  const webhook = ctx.env.DISCORD_WEBHOOK_RELEASES;
  if (!webhook) return;
  const release = await github.latestRelease(ctx);
  if (!release) return;
  const seen = await kvGet(ctx, "last_release");
  if (seen === release.tag_name) return;
  if (seen !== null) {
    await discord.postWebhook(ctx, "discord releases webhook", webhook, await releaseMessage(ctx, release));
    log("release_announced", { tag: release.tag_name });
    ctx.changes.add("release");
  }
  await kvSet(ctx, "last_release", release.tag_name);
}

export interface FeedEntry {
  id: string;
  title: string;
  url: string;
  updated: string;
  summary: string;
}

const unescape = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|#39|amp);/g, (_, e: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", amp: "&" })[e]!);

/** Entries of one of the site's own Atom feeds, newest first, as the feed lists them. */
export function parseFeed(xml: string): FeedEntry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
    const tag = (name: string) => unescape(entry!.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "");
    // Ids are absolute URLs; only the path is kept, so moving the site to another domain doesn't make every entry new.
    const id = tag("id").replace(/^https?:\/\/[^/]+/, "");
    return { id, title: tag("title"), url: unescape(entry!.match(/<link href="([^"]*)"/)?.[1] ?? ""), updated: tag("updated"), summary: tag("summary") };
  });
}

const FEED_PER_RUN = 5;
const FEED_REMEMBERED = 400;

interface FeedBridge {
  /** One of the site's feeds. */
  path: string;
  webhook: string | undefined;
  /** Where the ids already posted are remembered. */
  key: string;
  color: number;
  /** Entries to leave for later, such as a day that is not over yet. */
  ready?: (entry: FeedEntry) => boolean;
  /** Runs after an entry is posted, such as telling the members who follow its game. */
  after?: (ctx: Ctx, entry: FeedEntry) => Promise<void>;
}

/**
 * Posts new entries of one of the site's feeds (which update when the site rebuilds). Entries are remembered by id
 * rather than by date, because one can be dated before others already posted. The first run only records what is
 * there, so a backlog is never posted.
 */
async function announceFeed(ctx: Ctx, bridge: FeedBridge): Promise<void> {
  if (!bridge.webhook || !ctx.env.ASSETS) return;
  const res = await ctx.env.ASSETS.fetch(`${baseUrl(ctx.env)}${bridge.path}`);
  if (!res.ok) return;
  const all = parseFeed(await res.text());
  const entries = all.filter((e) => !bridge.ready || bridge.ready(e));
  const stored = await kvGet(ctx, bridge.key);
  const seen = new Set<string>(stored ? (JSON.parse(stored) as string[]) : []);
  const fresh = stored === null ? [] : entries.filter((e) => !seen.has(e.id)).reverse().slice(0, FEED_PER_RUN);
  // Newest first, so the oldest ids are the ones forgotten once the list is full. Saved after every post, so a
  // failure partway through never posts the earlier entries again.
  const remember = () => {
    const remembered = [...all.map((e) => e.id).filter((id) => seen.has(id)), ...[...seen].filter((id) => !all.some((e) => e.id === id))];
    return kvSet(ctx, bridge.key, JSON.stringify(remembered.slice(0, FEED_REMEMBERED)));
  };
  // The first run records everything there, ready or not, so nothing already in the feed is posted later as new.
  if (stored === null) {
    all.forEach((e) => seen.add(e.id));
    await remember();
    return;
  }
  for (const entry of fresh) {
    await discord.postWebhook(ctx, `discord webhook ${bridge.key}`, bridge.webhook, {
      embeds: [{ title: entry.title.slice(0, 256), url: entry.url, description: entry.summary.slice(0, 2000) || undefined, color: bridge.color, timestamp: entry.updated || undefined }],
    });
    seen.add(entry.id);
    await remember();
    log("feed_entry_announced", { feed: bridge.path, id: entry.id });
    await bridge.after?.(ctx, entry);
  }
}

/** Games that reached a new stage, from the site's games feed; members who follow the game get a direct message. */
export const announceGames = (ctx: Ctx) =>
  announceFeed(ctx, { path: "/feeds/games.xml", webhook: ctx.env.DISCORD_WEBHOOK_GAMES, key: "games_seen", color: 0x3ddc84, after: tellFollowers });

/** Direct messages per stage rise. Each takes two requests from the run's budget of about 44. */
const FOLLOWERS_PER_RISE = 10;

/** Tells the members following a game that it reached a new stage (entry ids look like /updates#stage:<slug>:<stage>). */
async function tellFollowers(ctx: Ctx, entry: FeedEntry): Promise<void> {
  const slug = entry.id.match(/#stage:([^:]+):/)?.[1];
  if (!slug) return;
  const { results } = await ctx.env.DB.prepare("SELECT discord_id FROM follows WHERE slug = ? ORDER BY created_at").bind(slug).all<{ discord_id: string }>();
  if (results.length > FOLLOWERS_PER_RISE) log("followers_skipped", { slug, skipped: results.length - FOLLOWERS_PER_RISE });
  const message = {
    embeds: [{ title: entry.title.slice(0, 256), url: entry.url, description: `${entry.summary.slice(0, 1500)}

You follow this game. \`/unfollow\` it in the server to stop these.`, color: 0x3ddc84 }],
  };
  for (const { discord_id } of results.slice(0, FOLLOWERS_PER_RISE)) {
    // A member who can't be messaged stops following, so they aren't tried on every rise.
    if (!(await discord.directMessage(ctx, discord_id, message))) {
      await ctx.env.DB.prepare("DELETE FROM follows WHERE discord_id = ?").bind(discord_id).run();
      log("follower_unreachable", { slug });
    }
  }
}

/**
 * Yesterday's progress summary and library milestones, from the site's daily feed. A day's summary keeps changing until the day is over and
 * the site has rebuilt, so a day is posted only from 01:00 UTC the next day, and once.
 */
export function announceDigest(ctx: Ctx, at = new Date()) {
  const today = at.toISOString().slice(0, 10);
  const yesterday = new Date(at.getTime() - 864e5).toISOString().slice(0, 10);
  const settled = (day: string) => day < yesterday || (day === yesterday && at.getUTCHours() >= 1);
  // With a channel of their own, library milestones are posted there as they happen instead.
  const ownChannel = (e: FeedEntry) => Boolean(ctx.env.DISCORD_WEBHOOK_LIBRARIES) && e.id.includes("#library:");
  return announceFeed(ctx, {
    path: "/feeds/progress-daily.xml",
    webhook: ctx.env.DISCORD_WEBHOOK_DIGEST || ctx.env.DISCORD_WEBHOOK_PROGRESS,
    key: "digest_seen",
    color: 0x37e0c8,
    ready: (e) => !ownChannel(e) && settled(e.id.match(/(?:digest|week|library):(\d{4}-\d{2}-\d{2})/)?.[1] ?? today),
  });
}

/** Library milestones as they happen, when they have a channel of their own (otherwise they come with the daily summary). */
export const announceLibraries = (ctx: Ctx) =>
  announceFeed(ctx, { path: "/feeds/libraries.xml", webhook: ctx.env.DISCORD_WEBHOOK_LIBRARIES, key: "libraries_seen", color: 0x5b9bff });

/**
 * The weekly summary, from Monday 01:00 UTC: libraries, shaders and games against the week before, what moved up and
 * what was merged. The first run only records this week's figures to compare against.
 */
export async function announceWeek(ctx: Ctx, at = new Date()): Promise<void> {
  const webhook = ctx.env.DISCORD_WEBHOOK_WEEKLY || ctx.env.DISCORD_WEBHOOK_DIGEST || ctx.env.DISCORD_WEBHOOK_PROGRESS;
  if (!webhook) return;
  const week = weekOf(at);
  const stored = await kvGet(ctx, "week_figures");
  const before = stored ? (JSON.parse(stored) as WeekFigures) : null;
  if (before?.week === week || (before && at.getUTCDay() === 1 && at.getUTCHours() < 1)) return;
  const data = await siteData(ctx.env);
  if (!data) return;
  const now = weekFigures(data, week, at.toISOString());
  if (before) {
    const feed = ctx.env.ASSETS ? await ctx.env.ASSETS.fetch(`${baseUrl(ctx.env)}/feeds/games.xml`) : null;
    const risen = feed?.ok ? parseFeed(await feed.text()).filter((e) => e.id.includes("#stage:") && e.updated > before.at).map((e) => `[${e.title}](${e.url})`) : [];
    await discord.postWebhook(ctx, "discord weekly webhook", webhook, await weekMessage(ctx, data, now, before, risen));
    log("week_announced", { week });
  }
  await kvSet(ctx, "week_figures", JSON.stringify(now));
}

/**
 * Notices new or updated Game bring-up discussions, so the site rebuilds with new reports. Reads the ten most recently
 * updated discussions in one query and remembers the newest bring-up update.
 */
export async function watchDiscussions(ctx: Ctx): Promise<void> {
  if (!ctx.env.SITE_DISPATCH_TOKEN) return;
  const [owner, name] = ctx.env.GITHUB_REPO.split("/");
  const data = await github.recentDiscussions(ctx, owner!, name!);
  const newest = data.filter((d) => d.category === "Game bring-up").map((d) => d.updatedAt).sort().at(-1);
  if (!newest) return;
  const seen = await kvGet(ctx, "discussions_updated");
  if (seen !== null && newest > seen) ctx.changes.add("reports");
  if (newest !== seen) await kvSet(ctx, "discussions_updated", newest);
}
