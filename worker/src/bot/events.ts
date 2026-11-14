import { renderWelcome } from "./settings";
import { P, permissionsOf, type Automod, type Member, type Role, type Settings, type User } from "./guild";

/**
 * What the bot does with what happens in the server, as the gateway (gateway.ts) sees it: automod, message and member
 * logs, welcome and goodbye messages, and roles for new members. Everything here decides; nothing calls Discord. The
 * calls are jobs, which the gateway queues and runs (jobs.ts), so a failed call is retried and the connection never
 * waits on one.
 */

export type Job =
  | { kind: "post"; channel: string; message: Record<string, unknown>; /** Deleted again after this many seconds. */ expires?: number }
  | { kind: "delete"; channel: string; message: string; reason: string }
  | { kind: "role"; guild: string; user: string; role: string; reason: string }
  | { kind: "punish"; guild: string; server: string; user: User; action: "warn" | "timeout"; reason: string; minutes: number }
  | { kind: "ban"; guild: string; user: User; banned: boolean }
  | { kind: "sticky"; channel: string };

export interface GuildState {
  id: string;
  name: string;
  owner_id: string;
  roles: Role[];
  memberCount: number;
  /** Threads and the channel each sits in, so automod's ignored channels cover their threads. */
  parents: Map<string, string>;
}

/** What the gateway remembers of a member, to log what changed. Pending: hasn't accepted the server's rules yet. */
export interface KnownMember {
  nick: string | null;
  roles: string[];
  pending: boolean;
}

const known = (m: Member): KnownMember => ({ nick: m.nick ?? null, roles: m.roles, pending: Boolean(m.pending) });

export interface CachedMessage {
  id: string;
  guild_id: string;
  channel_id: string;
  author_id: string;
  author_name: string;
  content: string;
  attachments: string[];
  created_at: number;
}

/** The gateway's memory and storage, as events need it. Tests give a plain in-memory one. */
export interface World {
  /** The bot's own user id: its messages never move a sticky or get checked. */
  botId: string;
  /** Channels with a sticky message that isn't paused. */
  hasSticky(channel: string): boolean;
  /** When each sticky channel last had its sticky queued to move, so a burst of messages moves it once. */
  stickyQueued: Map<string, number>;
  settings(guild: string): Settings | undefined;
  guild(guild: string): GuildState | undefined;
  message(id: string): CachedMessage | undefined;
  saveMessage(m: CachedMessage): void;
  member(guild: string, user: string): KnownMember | undefined;
  saveMember(guild: string, user: string, member: KnownMember): void;
  forgetMember(guild: string, user: string): void;
  enqueue(job: Job, delaySeconds?: number): void;
  /** Each member's recent messages, for the spam and duplicate filters. */
  recent: Map<string, { at: number; content: string }[]>;
  /** Messages automod deleted, so the delete log can say so. */
  removedByAutomod: Map<string, string>;
  now(): number;
}

interface MessageEvent {
  id: string;
  guild_id?: string;
  channel_id: string;
  content?: string;
  author?: User;
  member?: Member;
  webhook_id?: string;
  attachments?: { filename: string; url: string }[];
  mentions?: { id: string }[];
  mention_roles?: string[];
  mention_everyone?: boolean;
  edited_timestamp?: string | null;
}

const COLORS = { join: 0x23a55a, leave: 0xda373c, edit: 0xf0b232, delete: 0xda373c, member: 0x5b9bff };
const SPAM_WINDOW = 5;
const DUPLICATE_WINDOW = 60;
const NOTICE_SECONDS = 8;
const NEW_ACCOUNT_DAYS = 7;
/** How long after a message a sticky moves down: long enough for a burst of messages to move it once. */
const STICKY_DELAY = 3;
const createdAt = (id: string) => Number(BigInt(id) >> 22n) / 1000 + 1420070400;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Automod.

const INVITE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[\w-]+/i;
const URL = /https?:\/\/([^\s/<>"')]+)/gi;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const allowedHost = (host: string, allowed: string[]) => {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
};

/** Which filter a message breaks, and why in a few words. Spam and duplicates count on the member's recent messages. */
export function breaks(config: Automod, m: MessageEvent, recent: { at: number; content: string }[], now: number): { filter: keyof Automod["filters"]; why: string } | undefined {
  const f = config.filters;
  const content = m.content ?? "";
  if (f.invites && INVITE.test(content)) return { filter: "invites", why: "invite link" };
  if (f.links) {
    const hosts = [...content.matchAll(URL)].map((x) => x[1]!);
    if (hosts.some((h) => !allowedHost(h, config.allowedLinks))) return { filter: "links", why: "link" };
  }
  if (f.words && config.words.length) {
    const hit = config.words.find((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}($|[^\\p{L}\\p{N}])`, "iu").test(content));
    if (hit) return { filter: "words", why: "blocked word" };
  }
  if (f.mentions) {
    const count = new Set(m.mentions?.map((u) => u.id)).size + (m.mention_roles?.length ?? 0) + (m.mention_everyone ? 1 : 0);
    if (count >= (f.mentions.limit ?? 5)) return { filter: "mentions", why: `${count} mentions` };
  }
  if (f.caps) {
    const letters = content.match(/\p{L}/gu) ?? [];
    const upper = letters.filter((c) => c !== c.toLowerCase()).length;
    if (letters.length >= 10 && (upper / letters.length) * 100 >= (f.caps.limit ?? 70)) return { filter: "caps", why: "too many capitals" };
  }
  if (f.spam) {
    const inWindow = recent.filter((r) => now - r.at < SPAM_WINDOW).length;
    if (inWindow >= (f.spam.limit ?? 5)) return { filter: "spam", why: "sending messages too fast" };
  }
  if (f.duplicates && content.trim()) {
    const same = content.trim().toLowerCase();
    const repeats = (f.duplicates.limit ?? 3) - 1;
    const last = recent.filter((r) => now - r.at < DUPLICATE_WINDOW).slice(-repeats);
    if (repeats > 0 && last.length === repeats && last.every((r) => r.content === same)) return { filter: "duplicates", why: "repeating the same message" };
  }
  return undefined;
}

function exempt(world: World, settings: Settings, m: MessageEvent): boolean {
  if (!m.guild_id || !m.author || m.author.bot || m.webhook_id) return true;
  const config = settings.automod;
  const parent = world.guild(m.guild_id)?.parents.get(m.channel_id);
  if (config.ignoredChannels.includes(m.channel_id) || (parent && config.ignoredChannels.includes(parent))) return true;
  const roles = m.member?.roles ?? [];
  if (roles.some((r) => config.ignoredRoles.includes(r))) return true;
  // Until the server's roles are known, moderators can't be told apart, so nobody is checked.
  const guild = world.guild(m.guild_id);
  if (!guild) return true;
  return Boolean(permissionsOf(guild, m.author.id, roles) & P.MANAGE_MESSAGES);
}

function onMessage(world: World, m: MessageEvent): void {
  if (!m.guild_id || !m.author || m.author.bot || m.webhook_id) return;
  const now = world.now();
  world.saveMessage({
    id: m.id,
    guild_id: m.guild_id,
    channel_id: m.channel_id,
    author_id: m.author.id,
    author_name: m.author.username,
    content: m.content ?? "",
    attachments: (m.attachments ?? []).map((a) => a.url),
    created_at: now,
  });
  if (m.member) world.saveMember(m.guild_id, m.author.id, known(m.member));

  const key = `${m.guild_id}:${m.author.id}`;
  const recent = (world.recent.get(key) ?? []).filter((r) => now - r.at < DUPLICATE_WINDOW);
  const settings = world.settings(m.guild_id);
  const hit = settings && Object.keys(settings.automod.filters).length && !exempt(world, settings, m) ? breaks(settings.automod, m, recent, now) : undefined;
  world.recent.set(key, [...recent, { at: now, content: (m.content ?? "").trim().toLowerCase() }].slice(-10));
  if (!hit || !settings) return;

  const action = settings.automod.filters[hit.filter]!.action;
  world.removedByAutomod.set(m.id, hit.why);
  world.enqueue({ kind: "delete", channel: m.channel_id, message: m.id, reason: `Automod: ${hit.why}` });
  if (action === "delete") {
    world.enqueue({ kind: "post", channel: m.channel_id, message: { content: `<@${m.author.id}>, your message was removed: ${hit.why}.`, allowed_mentions: { users: [m.author.id] } }, expires: NOTICE_SECONDS });
  } else {
    const guild = world.guild(m.guild_id);
    world.enqueue({ kind: "punish", guild: m.guild_id, server: guild?.name ?? "the server", user: m.author, action, reason: `Automod: ${hit.why}`, minutes: settings.automod.timeoutMinutes });
  }
}

/** Any message but the bot's own, webhooks and other bots included, pushes a sticky up. */
function buriesSticky(world: World, m: MessageEvent): void {
  if (!world.hasSticky(m.channel_id) || m.author?.id === world.botId) return;
  const last = world.stickyQueued.get(m.channel_id) ?? 0;
  if (world.now() - last < STICKY_DELAY) return;
  world.stickyQueued.set(m.channel_id, world.now());
  world.enqueue({ kind: "sticky", channel: m.channel_id }, STICKY_DELAY);
}

// Logs.

const jump = (guild: string, channel: string, message: string) => `https://discord.com/channels/${guild}/${channel}/${message}`;

function onEdit(world: World, m: MessageEvent): void {
  if (!m.guild_id || m.content === undefined || !m.edited_timestamp) return;
  const before = world.message(m.id);
  if (!before || before.content === m.content) return;
  world.saveMessage({ ...before, content: m.content });
  const channel = world.settings(m.guild_id)?.logs.messages;
  if (!channel) return;
  world.enqueue({
    kind: "post",
    channel,
    message: {
      embeds: [
        {
          author: { name: before.author_name },
          description: `**<@${before.author_id}> edited a message in <#${m.channel_id}>** · [Jump](${jump(m.guild_id, m.channel_id, m.id)})`,
          color: COLORS.edit,
          fields: [
            { name: "Before", value: clip(before.content || "_empty_", 1024) },
            { name: "After", value: clip(m.content || "_empty_", 1024) },
          ],
          footer: { text: `User ${before.author_id} · Message ${m.id}` },
          timestamp: new Date(world.now() * 1000).toISOString(),
        },
      ],
    },
  });
}

function onDelete(world: World, guild: string | undefined, channelId: string, ids: string[]): void {
  if (!guild) return;
  const channel = world.settings(guild)?.logs.messages;
  const known = ids.map((id) => world.message(id)).filter((m): m is CachedMessage => Boolean(m));
  if (!channel || !known.length) return;
  if (ids.length > 1) {
    const lines = known.map((m) => `**${m.author_name}:** ${clip(m.content.replace(/\s+/g, " ") || "_attachment_", 150)}`);
    world.enqueue({
      kind: "post",
      channel,
      message: { embeds: [{ description: clip(`**${ids.length} messages were bulk deleted in <#${channelId}>**\n${lines.join("\n")}`, 4096), color: COLORS.delete, timestamp: new Date(world.now() * 1000).toISOString() }] },
    });
    return;
  }
  const m = known[0]!;
  const automod = world.removedByAutomod.get(m.id);
  world.removedByAutomod.delete(m.id);
  world.enqueue({
    kind: "post",
    channel,
    message: {
      embeds: [
        {
          author: { name: m.author_name },
          description: clip(`**A message from <@${m.author_id}> was deleted in <#${channelId}>${automod ? ` by automod (${automod})` : ""}**\n${m.content}`, 4096),
          color: COLORS.delete,
          ...(m.attachments.length ? { fields: [{ name: "Attachments", value: clip(m.attachments.join("\n"), 1024) }] } : {}),
          footer: { text: `User ${m.author_id} · Message ${m.id}` },
          timestamp: new Date(world.now() * 1000).toISOString(),
        },
      ],
    },
  });
}

function memberLog(world: World, guild: string, description: string, color: number, user: User): void {
  const channel = world.settings(guild)?.logs.members;
  if (!channel) return;
  world.enqueue({
    kind: "post",
    channel,
    message: { embeds: [{ author: { name: user.username }, description, color, footer: { text: `User ${user.id}` }, timestamp: new Date(world.now() * 1000).toISOString() }] },
  });
}

// Members.

function welcomeAndRoles(world: World, guild: string, user: User): void {
  const settings = world.settings(guild);
  if (!settings || user.bot) return;
  const state = world.guild(guild);
  const join = settings.welcome.join;
  if (join) {
    world.enqueue({
      kind: "post",
      channel: join.channel,
      message: { content: renderWelcome(join.message, user, state?.name ?? "the server", state?.memberCount), allowed_mentions: { users: [user.id] } },
    });
  }
  for (const role of settings.autoroles) world.enqueue({ kind: "role", guild, user: user.id, role, reason: "Autorole for new members" });
}

function onJoin(world: World, d: Member & { guild_id: string; user: User }): void {
  const state = world.guild(d.guild_id);
  if (state) state.memberCount++;
  world.saveMember(d.guild_id, d.user.id, known(d));
  const age = world.now() - createdAt(d.user.id);
  memberLog(
    world,
    d.guild_id,
    `**<@${d.user.id}> joined** · account made <t:${Math.floor(createdAt(d.user.id))}:R>${age < NEW_ACCOUNT_DAYS * 86400 ? " · ⚠️ new account" : ""}`,
    COLORS.join,
    d.user,
  );
  // Members who still have to accept the rules get their roles once they do (onUpdate).
  if (!d.pending) welcomeAndRoles(world, d.guild_id, d.user);
}

function onLeave(world: World, d: { guild_id: string; user: User }): void {
  const state = world.guild(d.guild_id);
  if (state) state.memberCount = Math.max(0, state.memberCount - 1);
  const before = world.member(d.guild_id, d.user.id);
  world.forgetMember(d.guild_id, d.user.id);
  const roles = before?.roles.filter((r) => r !== d.guild_id) ?? [];
  memberLog(world, d.guild_id, `**<@${d.user.id}> left**${roles.length ? `\nRoles: ${roles.map((r) => `<@&${r}>`).join(" ")}` : ""}`, COLORS.leave, d.user);
  const leave = world.settings(d.guild_id)?.welcome.leave;
  if (leave && !d.user.bot) {
    world.enqueue({ kind: "post", channel: leave.channel, message: { content: renderWelcome(leave.message, d.user, state?.name ?? "the server", state?.memberCount) } });
  }
}

function onUpdate(world: World, d: Member & { guild_id: string; user: User }): void {
  const before = world.member(d.guild_id, d.user.id);
  world.saveMember(d.guild_id, d.user.id, known(d));
  // Accepting the rules: welcomed and given roles now, rather than on joining.
  if (before?.pending && !d.pending) welcomeAndRoles(world, d.guild_id, d.user);
  if (!before) return;
  const changes: string[] = [];
  if ((before.nick ?? null) !== (d.nick ?? null)) changes.push(`Nickname: ${before.nick ? `**${before.nick}**` : "_none_"} → ${d.nick ? `**${d.nick}**` : "_none_"}`);
  const added = d.roles.filter((r) => !before.roles.includes(r));
  const removed = before.roles.filter((r) => !d.roles.includes(r));
  if (added.length) changes.push(`Got ${added.map((r) => `<@&${r}>`).join(" ")}`);
  if (removed.length) changes.push(`Lost ${removed.map((r) => `<@&${r}>`).join(" ")}`);
  if (changes.length) memberLog(world, d.guild_id, `**<@${d.user.id}> was updated**\n${changes.join("\n")}`, COLORS.member, d.user);
}

/** Handles one gateway event. */
export function handle(world: World, type: string, d: any): void {
  switch (type) {
    case "MESSAGE_CREATE":
      buriesSticky(world, d);
      return onMessage(world, d);
    case "MESSAGE_UPDATE":
      return onEdit(world, d);
    case "MESSAGE_DELETE":
      return onDelete(world, d.guild_id, d.channel_id, [d.id]);
    case "MESSAGE_DELETE_BULK":
      return onDelete(world, d.guild_id, d.channel_id, d.ids);
    case "GUILD_MEMBER_ADD":
      return onJoin(world, d);
    case "GUILD_MEMBER_REMOVE":
      return onLeave(world, d);
    case "GUILD_MEMBER_UPDATE":
      return onUpdate(world, d);
    case "GUILD_MEMBERS_CHUNK":
      for (const m of d.members as (Member & { user: User })[]) world.saveMember(d.guild_id, m.user.id, known(m));
      return;
    case "GUILD_BAN_ADD":
    case "GUILD_BAN_REMOVE":
      if (world.settings(d.guild_id)?.logs.moderation) world.enqueue({ kind: "ban", guild: d.guild_id, user: d.user, banned: type === "GUILD_BAN_ADD" }, 3);
      return;
  }
  updateGuild(world, type, d);
}

/** Keeps the gateway's picture of each server (name, owner, roles, threads) current. */
function updateGuild(world: World, type: string, d: any): void {
  const state = world.guild(d.guild_id ?? d.id);
  if (!state) return;
  switch (type) {
    case "GUILD_UPDATE":
      state.name = d.name;
      state.owner_id = d.owner_id;
      state.roles = d.roles ?? state.roles;
      return;
    case "GUILD_ROLE_CREATE":
    case "GUILD_ROLE_UPDATE":
      state.roles = [...state.roles.filter((r) => r.id !== d.role.id), d.role];
      return;
    case "GUILD_ROLE_DELETE":
      state.roles = state.roles.filter((r) => r.id !== d.role_id);
      return;
    case "THREAD_CREATE":
    case "THREAD_UPDATE":
      if (d.parent_id) state.parents.set(d.id, d.parent_id);
      return;
  }
}

/** A server's state from its GUILD_CREATE event. */
export function guildState(d: any): GuildState {
  const parents = new Map<string, string>();
  for (const t of d.threads ?? []) if (t.parent_id) parents.set(t.id, t.parent_id);
  return { id: d.id, name: d.name, owner_id: d.owner_id, roles: d.roles ?? [], memberCount: d.member_count ?? 0, parents };
}
