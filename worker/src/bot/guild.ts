import type { Filter } from "./automod-rules";
import { reply } from "./commands";
import { log, now, type Env } from "./env";
import { Http, HttpError } from "./http";

/**
 * What the server tools share (moderation.ts, roles.ts, tags.ts, settings.ts and the gateway): the interaction shape,
 * calls to Discord as the bot, per-server settings, and moderation cases with their log posts.
 */

export const API = "https://discord.com/api/v10";
export const EPHEMERAL = 64;
export const MODAL = 9;
export const AUTOCOMPLETE_RESULT = 8;

/** Permission bits, as Discord numbers them. */
export const P = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  MENTION_EVERYONE: 1n << 17n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
};

export interface Option {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
  options?: Option[];
}

export interface User {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface Member {
  user?: User;
  roles: string[];
  nick?: string | null;
  permissions?: string;
  communication_disabled_until?: string | null;
  pending?: boolean;
  joined_at?: string;
}

export interface Role {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed?: boolean;
}

export interface Interaction {
  type: number;
  id?: string;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  member?: Member & { user: User };
  user?: User;
  message?: { id: string };
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    values?: string[];
    options?: Option[];
    components?: unknown[];
    resolved?: { users?: Record<string, User>; members?: Record<string, Member>; roles?: Record<string, Role> };
  };
}

// Mentions in the bot's replies render as names but never notify anyone (reply() sets that).
export const privately = (content: string, extra: Record<string, unknown> = {}) => reply({ content, flags: EPHEMERAL, ...extra });
export const publicly = (content: string, extra: Record<string, unknown> = {}) => reply({ content, ...extra });

/** The subcommand that was run, with its group if it has one, and its options. */
export function subcommand(i: Interaction): { group?: string; name: string; options: Option[] } {
  const first = i.data?.options?.[0];
  if (first?.type === 2) {
    const sub = first.options?.[0];
    return { group: first.name, name: sub?.name ?? "", options: sub?.options ?? [] };
  }
  if (first?.type === 1) return { name: first.name, options: first.options ?? [] };
  return { name: "", options: i.data?.options ?? [] };
}

export const value = (options: Option[], name: string) => options.find((o) => o.name === name)?.value;
export const text = (options: Option[], name: string) => String(value(options, name) ?? "").trim();
export const focused = (options: Option[] | undefined): Option | undefined => {
  for (const o of options ?? []) {
    if (o.focused) return o;
    const inner = focused(o.options);
    if (inner) return inner;
  }
  return undefined;
};

/** The text a modal's input was submitted with, from either layout Discord uses (labels or action rows). */
export function submitted(components: unknown, id: string): string | undefined {
  if (!components || typeof components !== "object") return undefined;
  if (Array.isArray(components)) {
    for (const c of components) {
      const found = submitted(c, id);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const c = components as { custom_id?: string; value?: string; component?: unknown; components?: unknown };
  if (c.custom_id === id && typeof c.value === "string") return c.value;
  return submitted(c.component, id) ?? submitted(c.components, id);
}

/** A modal of text inputs, each wrapped in a label. */
export function modal(customId: string, title: string, inputs: { id: string; label: string; description?: string; long?: boolean; max: number; required?: boolean; value?: string; placeholder?: string }[]): Response {
  return Response.json({
    type: MODAL,
    data: {
      custom_id: customId,
      title: title.slice(0, 45),
      components: inputs.map((i) => ({
        type: 18,
        label: i.label,
        ...(i.description ? { description: i.description } : {}),
        component: {
          type: 4,
          custom_id: i.id,
          style: i.long ? 2 : 1,
          max_length: i.max,
          required: i.required ?? true,
          ...(i.value ? { value: i.value.slice(0, i.max) } : {}),
          ...(i.placeholder ? { placeholder: i.placeholder } : {}),
        },
      })),
    },
  });
}

export const name = (u: User | undefined) => u?.global_name || u?.username || "someone";

/** Calls Discord as the bot. `reason` goes to the server's audit log. Never logs URLs or tokens. */
export class Bot {
  constructor(
    readonly env: Env,
    readonly http = new Http(),
  ) {}

  call(label: string, method: string, path: string, body?: unknown, reason?: string): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (reason) headers["x-audit-log-reason"] = encodeURIComponent(reason.slice(0, 400));
    return this.http.send(label, `${API}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }

  /** The status of a call whose body isn't needed. */
  async status(label: string, method: string, path: string, body?: unknown, reason?: string): Promise<number> {
    const res = await this.call(label, method, path, body, reason);
    await res.body?.cancel();
    return res.status;
  }

  async json<T>(label: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.call(label, method, path, body);
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(label, res.status);
    }
    return res.json<T>();
  }

  /** Posts a message; mentions never ping unless the message says otherwise. The new message's id, or the error status. */
  async post(channel: string, message: Record<string, unknown>): Promise<{ id: string } | { status: number }> {
    const res = await this.call("discord post", "POST", `/channels/${channel}/messages`, { allowed_mentions: { parse: [] }, ...message });
    if (res.ok) return { id: (await res.json<{ id: string }>()).id };
    await res.body?.cancel();
    return { status: res.status };
  }

  /** Sends a member a direct message. False when they don't accept them. */
  async dm(user: string, message: Record<string, unknown>): Promise<boolean> {
    const open = await this.call("discord dm channel", "POST", "/users/@me/channels", { recipient_id: user });
    if (!open.ok) {
      await open.body?.cancel();
      return false;
    }
    const { id } = await open.json<{ id: string }>();
    return "id" in (await this.post(id, message));
  }
}

/** Why a call as the bot failed, in words a server admin can act on. */
export function refused(status: number, what: string): string {
  if (status === 403) return `I couldn't ${what}: I'm missing a permission, or my role is below theirs. Move the bot's role higher in Server Settings → Roles.`;
  if (status === 404) return `I couldn't ${what}: Discord couldn't find them.`;
  return `I couldn't ${what}: Discord answered ${status}. Try again in a minute.`;
}

// Per-server settings, as JSON under a key.

export interface LogChannels {
  messages?: string;
  members?: string;
  moderation?: string;
}

export interface Welcome {
  join?: { channel: string; message: string };
  leave?: { channel: string; message: string };
}

/** Delete only, delete and take a step on the warning ladder (warning, timeout, ban), or delete and answer (ETA). */
export type AutomodAction = "delete" | "strike" | "answer";
export interface AutomodFilter {
  /** Older settings may say warn or timeout, which are strikes now. */
  action: AutomodAction | "warn" | "timeout";
  /** Mentions per message, percent of capitals, messages per 5 seconds, repeats or channels, depending on the filter. */
  limit?: number;
}
/** Actions saved before the warning ladder (warn, timeout) are strikes now. */
export const actionOf = (f: AutomodFilter): AutomodAction => (f.action === "delete" || f.action === "answer" ? f.action : "strike");

export interface Automod {
  filters: Partial<Record<Filter, AutomodFilter>>;
  words: string[];
  allowedLinks: string[];
  ignoredChannels: string[];
  ignoredRoles: string[];
  /** How long the timeout on the ladder lasts, in minutes. */
  timeoutMinutes: number;
  /** The channel warnings point to; defaults to the server's own rules channel. */
  rulesChannel?: string;
}

export interface Settings {
  logs: LogChannels;
  welcome: Welcome;
  autoroles: string[];
  automod: Automod;
}

export const DEFAULTS: Settings = {
  logs: {},
  welcome: {},
  autoroles: [],
  automod: { filters: {}, words: [], allowedLinks: [], ignoredChannels: [], ignoredRoles: [], timeoutMinutes: 1440 },
};

/** A stored setting over its defaults, so settings saved before a new field existed still have it. */
function withDefaults<K extends keyof Settings>(key: K, stored: string | null): Settings[K] {
  const fallback = structuredClone(DEFAULTS[key]);
  if (stored === null) return fallback;
  const value = JSON.parse(stored);
  return Array.isArray(fallback) ? value : { ...fallback, ...value };
}

export async function getSetting<K extends keyof Settings>(env: Env, guild: string, key: K): Promise<Settings[K]> {
  const row = await env.DB.prepare("SELECT value FROM guild_settings WHERE guild_id = ? AND key = ?").bind(guild, key).first<string>("value");
  return withDefaults(key, row);
}

export async function setSetting<K extends keyof Settings>(env: Env, guild: string, key: K, value: Settings[K]): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO guild_settings (guild_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(guild, key, JSON.stringify(value), now())
    .run();
}

/** Every server's settings, for the gateway. */
export async function allSettings(env: Env): Promise<Map<string, Settings>> {
  const { results } = await env.DB.prepare("SELECT guild_id, key, value FROM guild_settings").all<{ guild_id: string; key: keyof Settings; value: string }>();
  const out = new Map<string, Settings>();
  for (const r of results) {
    if (!(r.key in DEFAULTS)) continue;
    const s = out.get(r.guild_id) ?? structuredClone(DEFAULTS);
    (s as unknown as Record<string, unknown>)[r.key] = withDefaults(r.key, r.value);
    out.set(r.guild_id, s);
  }
  return out;
}

// Durations, as moderators type them: 10m, 1h30m, 2d, 1w.

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

export function parseDuration(input: string): number | undefined {
  const parts = [...input.toLowerCase().replace(/\s+/g, "").matchAll(/(\d+)([smhdw])/g)];
  if (!parts.length || parts.map((p) => p[0]).join("") !== input.toLowerCase().replace(/\s+/g, "")) return undefined;
  return parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNITS[unit!]!, 0);
}

export function formatDuration(seconds: number): string {
  const out: string[] = [];
  for (const [unit, size] of [["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]] as const) {
    const n = Math.floor(seconds / size);
    if (n) out.push(`${n} ${unit}${n === 1 ? "" : "s"}`);
    seconds %= size;
  }
  return out.slice(0, 2).join(" ") || "0 seconds";
}

// Moderation cases.

export interface Case {
  guild_id: string;
  number: number;
  action: "warn" | "timeout" | "untimeout" | "kick" | "ban" | "unban";
  user_id: string;
  moderator_id: string;
  reason: string | null;
  duration: number | null;
  active: number;
  created_at: number;
}

export async function addCase(env: Env, c: Pick<Case, "guild_id" | "action" | "user_id" | "moderator_id" | "reason" | "duration">): Promise<Case> {
  const row = await env.DB.prepare(
    `INSERT INTO cases (guild_id, number, action, user_id, moderator_id, reason, duration, created_at)
     SELECT ?1, COALESCE(MAX(number), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7 FROM cases WHERE guild_id = ?1 RETURNING *`,
  )
    .bind(c.guild_id, c.action, c.user_id, c.moderator_id, c.reason, c.duration, now())
    .first<Case>();
  return row!;
}

const VERB: Record<Case["action"], [string, number]> = {
  warn: ["Warned", 0xf0b232],
  timeout: ["Timed out", 0xf0b232],
  untimeout: ["Timeout removed", 0x5b9bff],
  kick: ["Kicked", 0xe8743b],
  ban: ["Banned", 0xda373c],
  unban: ["Unbanned", 0x23a55a],
};

export const caseTitle = (c: Case) => `${VERB[c.action][0]} · case ${c.number}`;

/** Who acted: a moderator, automod (the bot), or someone the audit log didn't name ("0"). */
const moderator = (id: string, botId: string) => (id === botId ? "automod" : id === "0" ? "someone" : `<@${id}>`);

/** A case as a line, for /warnings. */
export const caseLine = (c: Case, botId: string) =>
  `**#${c.number}** ${VERB[c.action][0]}${c.duration ? ` for ${formatDuration(c.duration)}` : ""} by ${moderator(c.moderator_id, botId)} <t:${c.created_at}:R>${c.active ? "" : " (taken back)"}: ${c.reason ?? "no reason given"}`;

/** Posts a case to the server's moderation log, if it has one. */
export async function logCase(bot: Bot, c: Case, user?: User): Promise<void> {
  const { moderation } = await getSetting(bot.env, c.guild_id, "logs");
  if (!moderation) return;
  const posted = await bot.post(moderation, {
    embeds: [
      {
        title: caseTitle(c),
        color: VERB[c.action][1],
        fields: [
          { name: "Member", value: `<@${c.user_id}>${user ? ` (${user.username})` : ""}\n\`${c.user_id}\``, inline: true },
          { name: "Moderator", value: moderator(c.moderator_id, bot.env.DISCORD_CLIENT_ID).replace(/^[a-z]/, (x) => x.toUpperCase()), inline: true },
          ...(c.duration ? [{ name: "Duration", value: formatDuration(c.duration), inline: true }] : []),
          { name: "Reason", value: (c.reason ?? "No reason given").slice(0, 1024) },
        ],
        timestamp: new Date(c.created_at * 1000).toISOString(),
      },
    ],
  });
  if ("status" in posted) log("moderation_log_failed", { guild: c.guild_id, status: posted.status });
}

/** Tells a member what happened to them, before it happens where it would stop the message reaching them. */
export function noticeFor(c: Pick<Case, "action" | "reason" | "duration">, server: string): string {
  const what: Record<Case["action"], string> = {
    warn: "You were warned in",
    timeout: `You were timed out for ${formatDuration(c.duration ?? 0)} in`,
    untimeout: "Your timeout was lifted in",
    kick: "You were kicked from",
    ban: "You were banned from",
    unban: "You were unbanned from",
  };
  return `${what[c.action]} **${server}**.${c.reason ? `\nReason: ${c.reason}` : ""}`;
}

// The server's roles, for who may act on whom.

export interface GuildInfo {
  id: string;
  name: string;
  owner_id: string;
  roles: Role[];
}

export const guildInfo = (bot: Bot, guild: string) => bot.json<GuildInfo>("discord guild", "GET", `/guilds/${guild}`);

/** The highest role position among a member's roles; 0 is @everyone. */
export function topRole(guild: Pick<GuildInfo, "roles">, roleIds: string[]): number {
  const byId = new Map(guild.roles.map((r) => [r.id, r.position]));
  return Math.max(0, ...roleIds.map((id) => byId.get(id) ?? 0));
}

/** A member's server-wide permissions from their roles. Channel overrides aren't counted. */
export function permissionsOf(guild: Pick<GuildInfo, "id" | "owner_id" | "roles">, userId: string, roleIds: string[]): bigint {
  if (userId === guild.owner_id) return ~0n;
  const ids = new Set([guild.id, ...roleIds]);
  const perms = guild.roles.filter((r) => ids.has(r.id)).reduce((p, r) => p | BigInt(r.permissions), 0n);
  return perms & P.ADMINISTRATOR ? ~0n : perms;
}
