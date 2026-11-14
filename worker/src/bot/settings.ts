import { indexRules, scan, type Filter } from "./automod-rules";
import { baseUrl, log, type Env } from "./env";
import { links, siteData, type SiteData } from "./site-data";
import {
  actionOf,
  Bot,
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

/** What each automod filter catches, what its limit means and its default. */
export const FILTERS: Record<keyof Automod["filters"], { what: string; limit?: [string, number] }> = {
  scam: { what: "crypto promotion, fake giveaways and phishing links" },
  piracy: { what: "asking for or sharing games, PKGs, dumps, keys and firmware" },
  hidden: { what: "link shorteners, ad-lockers and links hidden in base64" },
  eta: { what: "\"when will it work?\" questions about PS5 games and GTA 6" },
  crosspost: { what: "the same message in several channels at once, as hacked accounts post", limit: ["channels within a minute", 3] },
  invites: { what: "Discord invite links to other servers" },
  links: { what: "links, except to allowed sites" },
  mentions: { what: "messages that mention many members or roles", limit: ["mentions in one message", 5] },
  caps: { what: "messages mostly in capitals", limit: ["percent capitals", 70] },
  spam: { what: "many messages in a few seconds", limit: ["messages in 5 seconds", 5] },
  duplicates: { what: "the same message again and again", limit: ["repeats in a row", 3] },
  words: { what: "blocked words" },
};

const ACTIONS: Record<AutomodAction, string> = {
  delete: "deletes the message, with a short notice",
  strike: "deletes the message and takes a step on the ladder: a public warning (only ever one), then a timeout, then a ban",
  answer: "deletes the question and answers it from the FAQ, at most every 3 minutes per channel",
};

/** What /automod setup turns on: the filters that replace Discord's keyword rules. */
const RECOMMENDED: Automod["filters"] = {
  scam: { action: "strike" },
  piracy: { action: "strike" },
  hidden: { action: "strike" },
  crosspost: { action: "strike", limit: 3 },
  mentions: { action: "strike", limit: 6 },
  invites: { action: "delete" },
  eta: { action: "answer" },
};

/** A welcome or goodbye message with its placeholders filled in. */
export function renderWelcome(template: string, user: { id: string; username: string }, server: string, count?: number): string {
  return template
    .replaceAll("{user}", `<@${user.id}>`)
    .replaceAll("{username}", user.username)
    .replaceAll("{server}", server)
    .replaceAll("{count}", count ? count.toLocaleString("en") : "");
}

/**
 * The server rules as text, so automod never catches someone quoting them: the rules in data/bot.yaml, and what's
 * posted in the given rules channels (embeds included, as rules are often posted). Also the FAQ's ETA answer.
 */
export async function serverRules(env: Env, bot: Bot, channels: string[]): Promise<{ text: string; eta?: string }> {
  let data: SiteData | null = await siteData(env);
  if (!data) {
    // A Durable Object may not have the site's assets bound; the published file is the same.
    data = await fetch(`${baseUrl(env)}/bot/data.json`)
      .then((r) => (r.ok ? r.json<SiteData>() : null))
      .catch(() => null);
  }
  const texts: string[] = [data?.rules ?? ""];
  for (const channel of channels) {
    const res = await bot.call("discord rules channel", "GET", `/channels/${channel}/messages?limit=50`);
    if (!res.ok) {
      await res.body?.cancel();
      continue;
    }
    type Embed = { title?: string; description?: string; fields?: { name: string; value: string }[] };
    for (const m of await res.json<{ content: string; embeds?: Embed[] }[]>()) {
      texts.push(m.content, ...(m.embeds ?? []).flatMap((e) => [e.title ?? "", e.description ?? "", ...(e.fields ?? []).flatMap((f) => [f.name, f.value])]));
    }
  }
  const eta = data?.answers?.find((a) => a.topic === "eta")?.text;
  return { text: texts.filter(Boolean).join("\n"), ...(eta ? { eta: links(env, eta) } : {}) };
}

/** Has the gateway read the settings again now, rather than within the minute. */
export async function reloadGateway(env: Env, rules = false): Promise<void> {
  try {
    await env.GATEWAY?.getByName("gateway").reload(rules);
  } catch (err) {
    log("gateway_reload_failed", { error: String(err) });
  }
}

async function save<K extends keyof Settings>(env: Env, guild: string, key: K, value: Settings[K]): Promise<void> {
  await setSetting(env, guild, key, value);
  // Automod's rules channel may have changed, and with it what counts as quoting the rules.
  await reloadGateway(env, key === "automod");
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
    if (!FILTERS[filter] || (action !== "off" && !(action in ACTIONS))) return privately("Unknown action.");
    if (action === "answer" && filter !== "eta") return privately("Only the ETA filter can answer; pick Delete or Strike for this one.");
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

  if (!group && name === "setup") {
    config.filters = { ...config.filters, ...RECOMMENDED };
    await save(env, guild, "automod", config);
    return privately(
      [
        "Turned on the recommended filters:",
        ...Object.entries(RECOMMENDED).map(([f, v]) => `- **${f}**: ${FILTERS[f as keyof typeof FILTERS].what}; ${ACTIONS[v.action as AutomodAction].replace(/^deletes the message and /, "")}`),
        "",
        `Timeouts last ${formatDuration(config.timeoutMinutes * 60)}. Warnings point to ${config.rulesChannel ? `<#${config.rulesChannel}>` : "the server's rules channel"}; change it with \`/automod rules\`.`,
        "Now turn off the keyword and regex rules in Server Settings → AutoMod, or both will act on the same messages. Keep Discord's **mention spam** and **suspected spam** rules: they stop messages before anyone sees them.",
        "Try a message with `/automod test` to see what would happen.",
      ].join("\n"),
    );
  }

  if (!group && name === "rules") {
    const channel = String(value(options, "channel"));
    config.rulesChannel = channel;
    await save(env, guild, "automod", config);
    return privately(`Warnings now point to <#${channel}>, and quoting what's posted there is never caught.`);
  }

  if (!group && name === "test") {
    return privately(await tryMessage(env, guild, config, text(options, "message")));
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
    return privately(`The ladder's timeout now lasts ${formatDuration(minutes * 60)}.`);
  }

  const filters = (Object.keys(FILTERS) as (keyof Automod["filters"])[]).map((f) => {
    const on = config.filters[f];
    return `- **${f}**: ${on ? `${actionOf(on)}${on.limit ? ` at ${on.limit} ${FILTERS[f].limit![0]}` : ""}` : "off"}`;
  });
  return privately(
    [
      "**Automod**",
      ...filters,
      `Blocked words: ${config.words.length ? config.words.map((w) => `||${w}||`).join(", ") : "none"}`,
      `Allowed sites: ${config.allowedLinks.join(", ") || "none"}`,
      `Ignored: ${[...config.ignoredChannels.map((c) => `<#${c}>`), ...config.ignoredRoles.map((r) => `<@&${r}>`)].join(", ") || "nothing"}`,
      `Warnings point to ${config.rulesChannel ? `<#${config.rulesChannel}>` : "the server's rules channel"}. The ladder's timeout lasts ${formatDuration(config.timeoutMinutes * 60)}. Members who can manage messages are never checked.`,
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


/** /automod test: what automod would make of a message, and why, without anyone being caught. */
async function tryMessage(env: Env, guild: string, config: Automod, message: string): Promise<string> {
  const bot = new Bot(env);
  const { text: rules } = await serverRules(env, bot, config.rulesChannel ? [config.rulesChannel] : []);
  const read = (enabled: Partial<Record<Filter, { limit?: number }>>) =>
    scan({ content: message, mentions: 0, everyone: /@(?:everyone|here)\b/.test(message), newcomer: false }, { enabled, words: config.words, allowedLinks: config.allowedLinks, rules: indexRules(rules) });
  const on = Object.fromEntries(Object.entries(config.filters).map(([k, v]) => [k, { limit: v.limit }]));
  const verdict = read(on);
  if (verdict) {
    const action = actionOf(config.filters[verdict.filter]!);
    const outcome = action === "strike" ? (verdict.severe ? "a strike that skips the warning (straight to a timeout)" : "a strike") : action === "answer" ? "the ETA answer" : "a short notice";
    return `Caught by **${verdict.filter}**: ${verdict.why}.\nMatched: ${verdict.evidence.join(", ")}.\nThe message would be deleted, with ${outcome}.`;
  }
  const all = Object.fromEntries((Object.keys(FILTERS) as Filter[]).filter((f) => !["links", "caps", "words"].includes(f)).map((f) => [f, {}]));
  const off = read(all);
  if (off) return `Not caught with the filters that are on. The **${off.filter}** filter would catch it (${off.evidence.join(", ")}), but it's off.`;
  return "Not caught. Quotes of the server rules never are, and a single word like \"bitcoin\" or \"torrent\" alone isn't enough.";
}
