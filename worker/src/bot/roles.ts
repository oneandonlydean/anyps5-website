import { log, now, type Env } from "./env";
import {
  AUTOCOMPLETE_RESULT,
  Bot,
  focused,
  modal,
  P,
  privately,
  subcommand,
  submitted,
  text,
  value,
  type Interaction,
} from "./guild";

/**
 * Self-assign role panels, Carl-bot's reaction roles as buttons or a menu: /roles create posts a panel, /roles add puts
 * a role on it, and members click to get or drop a role. A panel's mode decides how: toggle (get and drop freely),
 * unique (one of its roles at a time) or add (get only; for agreeing to rules, say).
 */

const MAX_ROLES = 25;
const COLOR = 0x5b9bff;
/** Roles that would hand out moderation powers; a panel never offers them. */
const POWERS =
  P.ADMINISTRATOR | P.MANAGE_GUILD | P.MANAGE_ROLES | P.MANAGE_CHANNELS | P.BAN_MEMBERS | P.KICK_MEMBERS | P.MANAGE_MESSAGES | P.MODERATE_MEMBERS | P.MENTION_EVERYONE | P.MANAGE_WEBHOOKS;

type Style = "buttons" | "menu";
type Mode = "toggle" | "unique" | "add";

interface Panel {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  title: string;
  description: string;
  style: Style;
  mode: Mode;
}

interface PanelRole {
  panel_id: number;
  role_id: string;
  label: string;
  emoji: string | null;
  description: string | null;
  position: number;
}

const FOOTER: Record<Mode, string> = {
  toggle: "Pick a role to get it; pick it again to drop it.",
  unique: "You can have one of these roles at a time.",
  add: "Roles from this panel stay once you have them.",
};

/** A typed emoji as Discord's component emoji: a custom one (<:name:id>) or a single Unicode emoji. */
export function parseEmoji(input: string): { id?: string; name: string; animated?: boolean } | undefined {
  const custom = input.match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
  if (custom) return { id: custom[3], name: custom[2]!, ...(custom[1] ? { animated: true } : {}) };
  if (input && input.length <= 16 && /^\p{Extended_Pictographic}/u.test(input)) return { name: input };
  return undefined;
}

function render(panel: Panel, roles: PanelRole[]): Record<string, unknown> {
  const lines = roles.map((r) => `${r.emoji ?? "•"} <@&${r.role_id}>${r.description ? ` · ${r.description}` : ""}`);
  const embed = {
    title: panel.title,
    description: [panel.description, lines.join("\n") || "_No roles yet. Add some with `/roles add`._"].filter(Boolean).join("\n\n").slice(0, 4096),
    color: COLOR,
    footer: { text: FOOTER[panel.mode] },
  };
  if (!roles.length) return { embeds: [embed], components: [] };
  const emoji = (r: PanelRole) => (r.emoji ? parseEmoji(r.emoji) : undefined);
  if (panel.style === "menu") {
    return {
      embeds: [embed],
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `rolemenu:${panel.id}`,
              placeholder: panel.mode === "unique" ? "Pick a role" : "Pick roles to get or drop",
              min_values: 1,
              max_values: panel.mode === "unique" ? 1 : roles.length,
              options: roles.map((r) => ({
                label: r.label,
                value: r.role_id,
                ...(r.description ? { description: r.description.slice(0, 100) } : {}),
                ...(emoji(r) ? { emoji: emoji(r) } : {}),
              })),
            },
          ],
        },
      ],
    };
  }
  const rows: unknown[] = [];
  for (let i = 0; i < roles.length; i += 5) {
    rows.push({
      type: 1,
      components: roles.slice(i, i + 5).map((r) => ({ type: 2, style: 2, label: r.label, custom_id: `role:${panel.id}:${r.role_id}`, ...(emoji(r) ? { emoji: emoji(r) } : {}) })),
    });
  }
  return { embeds: [embed], components: rows };
}

const getPanel = (env: Env, guild: string, id: number) => env.DB.prepare("SELECT * FROM role_panels WHERE id = ? AND guild_id = ?").bind(id, guild).first<Panel>();
const panelRoles = async (env: Env, id: number) =>
  (await env.DB.prepare("SELECT * FROM role_panel_roles WHERE panel_id = ? ORDER BY position").bind(id).all<PanelRole>()).results;

/** Redraws a panel's message, posting it again if it was deleted. False if the bot can't post there. */
async function refresh(bot: Bot, panel: Panel): Promise<boolean> {
  const message = render(panel, await panelRoles(bot.env, panel.id));
  if (panel.message_id) {
    const status = await bot.status("discord panel edit", "PATCH", `/channels/${panel.channel_id}/messages/${panel.message_id}`, message);
    if (status < 300) return true;
    if (status !== 404) return false;
  }
  const posted = await bot.post(panel.channel_id, message);
  if ("status" in posted) return false;
  await bot.env.DB.prepare("UPDATE role_panels SET message_id = ? WHERE id = ?").bind(posted.id, panel.id).run();
  return true;
}

const CANNOT_POST = "I can't post in that channel. Give the bot **View Channel**, **Send Messages** and **Embed Links** there.";

export async function rolesCommand(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  if (!guild || !i.member) return privately("Use this in a server.");
  const { name, options } = subcommand(i);
  const bot = new Bot(env);

  if (name === "create") {
    const style = text(options, "style") || "buttons";
    const mode = text(options, "mode") || "toggle";
    const channel = String(value(options, "channel") ?? i.channel_id);
    return modal(`roles:create:${style}:${mode}:${channel}`, "New role panel", [
      { id: "title", label: "Title", max: 256, placeholder: "Pick your roles" },
      { id: "description", label: "Description", description: "Shown above the roles. Optional.", long: true, max: 2000, required: false },
    ]);
  }

  if (name === "list") {
    const { results } = await env.DB.prepare(
      "SELECT p.*, (SELECT COUNT(*) FROM role_panel_roles r WHERE r.panel_id = p.id) AS roles FROM role_panels p WHERE guild_id = ? ORDER BY id",
    )
      .bind(guild)
      .all<Panel & { roles: number }>();
    if (!results.length) return privately("No role panels yet. Make one with `/roles create`.");
    return privately(
      results
        .map((p) => {
          const where = p.message_id ? `https://discord.com/channels/${guild}/${p.channel_id}/${p.message_id}` : `<#${p.channel_id}>`;
          return `**${p.id}.** ${p.title} · ${p.roles} role${p.roles === 1 ? "" : "s"}, ${p.style}, ${p.mode} · ${where}`;
        })
        .join("\n"),
    );
  }

  const panel = await getPanel(env, guild, Number(value(options, "panel")));
  if (!panel) return privately("There's no such panel. `/roles list` shows them.");

  if (name === "edit") {
    return modal(`roles:edit:${panel.id}`, "Edit role panel", [
      { id: "title", label: "Title", max: 256, value: panel.title },
      { id: "description", label: "Description", long: true, max: 2000, required: false, value: panel.description },
    ]);
  }

  if (name === "delete") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM role_panel_roles WHERE panel_id = ?").bind(panel.id),
      env.DB.prepare("DELETE FROM role_panels WHERE id = ?").bind(panel.id),
    ]);
    if (panel.message_id) await bot.status("discord panel delete", "DELETE", `/channels/${panel.channel_id}/messages/${panel.message_id}`);
    return privately(`Deleted the panel **${panel.title}**. Members keep the roles they took from it.`);
  }

  const roleId = String(value(options, "role") ?? "");
  const role = i.data?.resolved?.roles?.[roleId];
  const current = await panelRoles(env, panel.id);

  if (name === "add") {
    if (!role) return privately("Pick a role.");
    if (role.id === guild) return privately("Everyone has @everyone already.");
    if (role.managed) return privately(`<@&${role.id}> belongs to a bot or integration, so it can't be handed out.`);
    if (BigInt(role.permissions) & POWERS) {
      return privately(`<@&${role.id}> has moderation or admin permissions, so a panel won't hand it out. Use a role without them.`);
    }
    const existing = current.find((r) => r.role_id === role.id);
    if (!existing && current.length >= MAX_ROLES) return privately(`A panel holds up to ${MAX_ROLES} roles. Make another with \`/roles create\`.`);
    const emoji = text(options, "emoji");
    if (emoji && !parseEmoji(emoji)) return privately("That emoji isn't one I can use. Pick a single emoji, or one of this server's own.");
    await env.DB.prepare(
      `INSERT INTO role_panel_roles (panel_id, role_id, label, emoji, description, position) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(panel_id, role_id) DO UPDATE SET label = excluded.label, emoji = excluded.emoji, description = excluded.description`,
    )
      .bind(panel.id, role.id, (text(options, "label") || role.name).slice(0, 80), emoji || null, text(options, "description").slice(0, 100) || null, current.length)
      .run();
    if (!(await refresh(bot, panel))) return privately(CANNOT_POST);
    return privately(
      `${existing ? "Updated" : "Added"} <@&${role.id}> on **${panel.title}**. The bot's own role must be above it in Server Settings → Roles, or members will get an error.`,
    );
  }

  if (name === "remove") {
    if (!current.some((r) => r.role_id === roleId)) return privately(`<@&${roleId}> isn't on **${panel.title}**.`);
    await env.DB.prepare("DELETE FROM role_panel_roles WHERE panel_id = ? AND role_id = ?").bind(panel.id, roleId).run();
    await refresh(bot, panel);
    return privately(`Took <@&${roleId}> off **${panel.title}**. Members who have it keep it.`);
  }
  return privately("Unknown command.");
}

/** The forms from /roles create and /roles edit. */
export async function rolesSubmit(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  const caller = i.member?.user.id;
  const [, kind, ...rest] = (i.data?.custom_id ?? "").split(":");
  if (!guild || !caller) return privately("Use this in a server.");
  const title = submitted(i.data?.components, "title")?.trim() ?? "";
  const description = submitted(i.data?.components, "description")?.trim() ?? "";
  if (!title) return privately("A panel needs a title.");
  const bot = new Bot(env);

  if (kind === "create") {
    const [style, mode, channel] = rest as [Style, Mode, string];
    const panel = await env.DB.prepare(
      "INSERT INTO role_panels (guild_id, channel_id, title, description, style, mode, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
      .bind(guild, channel, title, description, style === "menu" ? "menu" : "buttons", ["unique", "add"].includes(mode) ? mode : "toggle", caller, now())
      .first<Panel>();
    if (!(await refresh(bot, panel!))) {
      await env.DB.prepare("DELETE FROM role_panels WHERE id = ?").bind(panel!.id).run();
      return privately(CANNOT_POST);
    }
    return privately(`Posted panel **${panel!.id}** in <#${channel}>. Now add roles with \`/roles add panel:${panel!.id}\`.`);
  }

  if (kind === "edit") {
    const panel = await getPanel(env, guild, Number(rest[0]));
    if (!panel) return privately("That panel was deleted.");
    await env.DB.prepare("UPDATE role_panels SET title = ?, description = ? WHERE id = ?").bind(title, description, panel.id).run();
    await refresh(bot, { ...panel, title, description });
    return privately(`Updated **${title}**.`);
  }
  return privately("Unknown form.");
}

/** A member clicked a panel's button or picked from its menu. */
export async function rolesClick(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  const member = i.member;
  if (!guild || !member) return privately("Use this in a server.");
  const id = i.data?.custom_id ?? "";
  const [kind, panelId, roleId] = id.split(":");
  const panel = await getPanel(env, guild, Number(panelId));
  if (!panel) return privately("This panel was deleted.");
  const roles = await panelRoles(env, panel.id);
  const onPanel = new Set(roles.map((r) => r.role_id));
  const picked = (kind === "role" ? [roleId!] : (i.data?.values ?? [])).filter((r) => onPanel.has(r));
  if (!picked.length) return privately("That role isn't on this panel any more.");

  const has = new Set(member.roles);
  const add: string[] = [];
  const remove: string[] = [];
  for (const r of picked) {
    if (!has.has(r)) add.push(r);
    else if (panel.mode !== "add") remove.push(r);
  }
  // Unique: getting one of the panel's roles drops the others.
  if (panel.mode === "unique" && add.length) remove.push(...roles.map((r) => r.role_id).filter((r) => has.has(r) && r !== add[0]));

  const bot = new Bot(env);
  const user = member.user.id;
  const failed: string[] = [];
  for (const [method, list] of [["PUT", add], ["DELETE", remove]] as const) {
    for (const r of list) {
      const status = await bot.status("discord member role", method, `/guilds/${guild}/members/${user}/roles/${r}`, undefined, `Role panel: ${panel.title}`);
      if (status >= 300) {
        failed.push(r);
        log("role_panel_failed", { guild, role: r, status });
      }
    }
  }
  const done = (list: string[]) => list.filter((r) => !failed.includes(r)).map((r) => `<@&${r}>`);
  const lines = [
    ...(done(add).length ? [`Gave you ${done(add).join(", ")}.`] : []),
    ...(done(remove).length ? [`Took away ${done(remove).join(", ")}.`] : []),
    ...(failed.length ? [`I couldn't change ${failed.map((r) => `<@&${r}>`).join(", ")}: the bot's role needs to be above ${failed.length === 1 ? "it" : "them"}. Tell a server admin.`] : []),
  ];
  if (!add.length && !remove.length) lines.push(`You already have ${picked.map((r) => `<@&${r}>`).join(", ")}.`);
  return privately(lines.join("\n"));
}

/** Suggestions for a panel option: the server's panels. */
export async function suggestPanels(env: Env, i: Interaction): Promise<Response> {
  const typed = String(focused(i.data?.options)?.value ?? "").toLowerCase();
  const { results } = await env.DB.prepare("SELECT id, title FROM role_panels WHERE guild_id = ? ORDER BY id").bind(i.guild_id ?? "").all<{ id: number; title: string }>();
  const choices = results
    .filter((p) => !typed || String(p.id).startsWith(typed) || p.title.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((p) => ({ name: `${p.id}. ${p.title}`.slice(0, 100), value: p.id }));
  return Response.json({ type: AUTOCOMPLETE_RESULT, data: { choices } });
}
