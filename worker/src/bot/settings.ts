import { log, type Env } from "./env";
import {
  formatDuration,
  getSetting,
  modal,
  P,
  privately,
  setSetting,
  subcommand,
  submitted,
  text,
  value,
  type Automod,
  type AutomodAction,
  type Interaction,
  type Settings,
} from "./guild";

/**
 * The commands that set up what the gateway does (gateway.ts, events.ts): /logs, /welcome, /autorole and /automod.
 * Each saves a per-server setting and tells the gateway to read it again.
 */

export const SETTINGS = new Set(["logs", "welcome", "autorole", "automod"]);

const MAX_AUTOROLES = 10;
const MAX_WORDS = 200;
const POWERS = P.ADMINISTRATOR | P.MANAGE_GUILD | P.MANAGE_ROLES | P.MANAGE_CHANNELS | P.BAN_MEMBERS | P.KICK_MEMBERS | P.MANAGE_MESSAGES | P.MODERATE_MEMBERS;

/** What each automod filter's limit means, and its default. */
export const FILTERS: Record<keyof Automod["filters"], { what: string; limit?: [string, number] }> = {
  invites: { what: "Discord invite links to other servers" },
  links: { what: "links, except to allowed sites" },
  mentions: { what: "messages that mention many members or roles", limit: ["mentions in one message", 5] },
  caps: { what: "messages mostly in capitals", limit: ["percent capitals", 70] },
  spam: { what: "many messages in a few seconds", limit: ["messages in 5 seconds", 5] },
  duplicates: { what: "the same message again and again", limit: ["repeats in a row", 3] },
  words: { what: "blocked words" },
};

const ACTIONS: Record<AutomodAction, string> = {
  delete: "deletes the message",
  warn: "deletes the message and warns them",
  timeout: "deletes the message and times them out",
};

/** A welcome or goodbye message with its placeholders filled in. */
export function renderWelcome(template: string, user: { id: string; username: string }, server: string, count?: number): string {
  return template
    .replaceAll("{user}", `<@${user.id}>`)
    .replaceAll("{username}", user.username)
    .replaceAll("{server}", server)
    .replaceAll("{count}", count ? count.toLocaleString("en") : "");
}

/** Has the gateway read the settings again now, rather than within the minute. */
export async function reloadGateway(env: Env): Promise<void> {
  try {
    await env.GATEWAY?.getByName("gateway").reload();
  } catch (err) {
    log("gateway_reload_failed", { error: String(err) });
  }
}

async function save<K extends keyof Settings>(env: Env, guild: string, key: K, value: Settings[K]): Promise<void> {
  await setSetting(env, guild, key, value);
  await reloadGateway(env);
}

const handsOutPowers = (i: Interaction, roleId: string) => {
  const role = i.data?.resolved?.roles?.[roleId];
  return !role || role.managed || role.id === i.guild_id || Boolean(BigInt(role.permissions) & POWERS);
};

export async function settingsCommand(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  if (!guild) return privately("Use this in a server.");
  const { group, name, options } = subcommand(i);
  const command = i.data?.name;

  if (command === "logs") {
    const logs = await getSetting(env, guild, "logs");
    const type = text(options, "type") as keyof typeof logs;
    if (name === "set") {
      const channel = String(value(options, "channel"));
      await save(env, guild, "logs", { ...logs, [type]: channel });
      return privately(`${LOG_NAMES[type]} now go to <#${channel}>. The bot needs **View Channel**, **Send Messages** and **Embed Links** there.`);
    }
    if (name === "off") {
      delete logs[type];
      await save(env, guild, "logs", logs);
      return privately(`Stopped logging ${LOG_NAMES[type].toLowerCase()}.`);
    }
    return privately(
      (Object.keys(LOG_NAMES) as (keyof typeof logs)[]).map((k) => `**${LOG_NAMES[k]}:** ${logs[k] ? `<#${logs[k]}>` : "off"}`).join("\n"),
    );
  }

  if (command === "welcome") {
    const welcome = await getSetting(env, guild, "welcome");
    if (name === "join" || name === "leave") {
      const channel = String(value(options, "channel"));
      const current = welcome[name]?.message;
      return modal(`settings:welcome:${name}:${channel}`, name === "join" ? "Welcome message" : "Goodbye message", [
        {
          id: "message",
          label: "Message",
          description: "{user} mentions them, {username} is their name, {server} the server's, {count} the member count.",
          long: true,
          max: 2000,
          value: current ?? (name === "join" ? "Welcome to {server}, {user}! You're member #{count}." : "{username} left the server."),
        },
      ]);
    }
    if (name === "off") {
      const which = text(options, "which") as "join" | "leave";
      delete welcome[which];
      await save(env, guild, "welcome", welcome);
      return privately(`Turned off the ${which === "join" ? "welcome" : "goodbye"} message.`);
    }
    const me = i.member?.user ?? { id: "0", username: "you" };
    const show = (which: "join" | "leave") => {
      const w = welcome[which];
      return w ? `**${which === "join" ? "Welcome" : "Goodbye"}** in <#${w.channel}>:\n>>> ${renderWelcome(w.message, me, "this server", 123)}` : `**${which === "join" ? "Welcome" : "Goodbye"}:** off`;
    };
    return privately(`${show("join")}\n\n${show("leave")}`);
  }

  if (command === "autorole") {
    const roles = await getSetting(env, guild, "autoroles");
    const role = String(value(options, "role") ?? "");
    if (name === "add") {
      if (handsOutPowers(i, role)) return privately(`<@&${role}> can't be given automatically: it's @everyone, a bot's role, or has moderation permissions.`);
      if (roles.includes(role)) return privately(`<@&${role}> is already given to new members.`);
      if (roles.length >= MAX_AUTOROLES) return privately(`New members can get up to ${MAX_AUTOROLES} roles.`);
      await save(env, guild, "autoroles", [...roles, role]);
      return privately(
        `New members now get <@&${role}>. The bot's role must be above it in Server Settings → Roles. If the server has rules to accept, they get it once they accept.`,
      );
    }
    if (name === "remove") {
      await save(env, guild, "autoroles", roles.filter((r) => r !== role));
      return privately(`New members no longer get <@&${role}>.`);
    }
    return privately(roles.length ? `New members get ${roles.map((r) => `<@&${r}>`).join(", ")}.` : "New members get no roles. Add one with `/autorole add`.");
  }

  if (command === "automod") return automod(env, i, guild, group, name, options);
  return privately("Unknown command.");
}

const LOG_NAMES = { messages: "Edited and deleted messages", members: "Joins, leaves, nicknames and roles", moderation: "Moderation cases and bans" } as const;

async function automod(env: Env, i: Interaction, guild: string, group: string | undefined, name: string, options: ReturnType<typeof subcommand>["options"]): Promise<Response> {
  const config = await getSetting(env, guild, "automod");
  const list = (input: string) =>
    input
      .toLowerCase()
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);

  if (!group && name === "filter") {
    const filter = text(options, "filter") as keyof Automod["filters"];
    const action = text(options, "action");
    const info = FILTERS[filter];
    if (action === "off") {
      delete config.filters[filter];
      await save(env, guild, "automod", config);
      return privately(`Turned off the ${filter} filter.`);
    }
    const limit = Number(value(options, "limit") ?? config.filters[filter]?.limit ?? info.limit?.[1] ?? 0) || undefined;
    config.filters[filter] = { action: action as AutomodAction, ...(info.limit ? { limit } : {}) };
    await save(env, guild, "automod", config);
    const extra =
      filter === "words" && !config.words.length
        ? " Add words with `/automod words add`."
        : filter === "links" && !config.allowedLinks.length
          ? " Allow sites with `/automod links allow`."
          : "";
    return privately(
      `The ${filter} filter now catches ${info.what}${info.limit ? ` (${limit} ${info.limit[0]})` : ""} and ${ACTIONS[action as AutomodAction]}.${extra} Moderators and the channels and roles set with \`/automod ignore\` are left alone.`,
    );
  }

  if (group === "words") {
    const words = list(text(options, "words"));
    config.words = name === "add" ? [...new Set([...config.words, ...words])].slice(0, MAX_WORDS) : config.words.filter((w) => !words.includes(w));
    await save(env, guild, "automod", config);
    return privately(`${config.words.length} blocked word${config.words.length === 1 ? "" : "s"}.${config.filters.words ? "" : " Turn the filter on with `/automod filter words`."}`);
  }

  if (group === "links") {
    const domains = list(text(options, "domains")).map((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""));
    config.allowedLinks = name === "allow" ? [...new Set([...config.allowedLinks, ...domains])] : config.allowedLinks.filter((d) => !domains.includes(d));
    await save(env, guild, "automod", config);
    return privately(config.allowedLinks.length ? `Links allowed to: ${config.allowedLinks.join(", ")} (and their subdomains).` : "No sites are allowed: every link is caught when the links filter is on.");
  }

  if (group === "ignore") {
    const key = name === "channel" ? "ignoredChannels" : "ignoredRoles";
    const id = String(value(options, name));
    const ignored = config[key].includes(id);
    config[key] = ignored ? config[key].filter((x) => x !== id) : [...config[key], id];
    await save(env, guild, "automod", config);
    const mention = name === "channel" ? `<#${id}>` : `<@&${id}>`;
    return privately(ignored ? `Automod checks ${mention} again.` : `Automod now leaves ${mention} alone.`);
  }

  if (!group && name === "timeout") {
    const minutes = Number(value(options, "minutes"));
    config.timeoutMinutes = minutes;
    await save(env, guild, "automod", config);
    return privately(`Automod timeouts now last ${formatDuration(minutes * 60)}.`);
  }

  const filters = (Object.keys(FILTERS) as (keyof Automod["filters"])[]).map((f) => {
    const on = config.filters[f];
    return `- **${f}**: ${on ? `${on.action}${on.limit ? ` at ${on.limit} ${FILTERS[f].limit![0]}` : ""}` : "off"}`;
  });
  return privately(
    [
      "**Automod**",
      ...filters,
      `Blocked words: ${config.words.length ? config.words.map((w) => `||${w}||`).join(", ") : "none"}`,
      `Allowed sites: ${config.allowedLinks.join(", ") || "none"}`,
      `Ignored: ${[...config.ignoredChannels.map((c) => `<#${c}>`), ...config.ignoredRoles.map((r) => `<@&${r}>`)].join(", ") || "nothing"}`,
      `Timeouts last ${formatDuration(config.timeoutMinutes * 60)}. Members who can manage messages are never checked.`,
    ].join("\n"),
  );
}

/** The forms from /welcome join and /welcome leave. */
export async function settingsSubmit(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  if (!guild) return privately("Use this in a server.");
  const [, kind, which, channel] = (i.data?.custom_id ?? "").split(":");
  const message = submitted(i.data?.components, "message")?.trim() ?? "";
  if (kind !== "welcome" || (which !== "join" && which !== "leave") || !channel) return privately("Unknown form.");
  if (!message) return privately("The message can't be empty.");
  const welcome = await getSetting(env, guild, "welcome");
  welcome[which] = { channel, message };
  await save(env, guild, "welcome", welcome);
  return privately(
    `${which === "join" ? "New members are welcomed" : "Goodbyes are posted"} in <#${channel}>. The bot needs **Send Messages** there. \`/welcome show\` previews it.`,
  );
}

