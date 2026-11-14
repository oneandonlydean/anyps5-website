import { COMMANDS, HELP_SECTIONS, type Command } from "../../scripts/commands.mjs";
import { reply } from "./commands";

/** /help: every command the caller can use, grouped as on the maintainers' page, from the definitions Discord gets. */

const EPHEMERAL = 64;
const ADMINISTRATOR = 8n;
/** Discord's limit on an embed field's value. */
const FIELD_MAX = 1024;

const commands = new Map(COMMANDS.map((c) => [c.name, c]));

/** Subcommands read as alternatives, like /sticky set|remove; other options as <required> [optional]. */
const usage = (c: Command) =>
  c.options?.every((o) => o.type === 1 || o.type === 2)
    ? `/${c.name} ${c.options.map((o) => o.name).join("|")}`
    : [`/${c.name}`, ...(c.options ?? []).map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))].join(" ");

/**
 * Whether the caller has the permission a command needs by default. An admin can let other roles use a command in
 * Server Settings → Integrations, which this can't see, so it's the default rule.
 */
function allowed(c: Command, permissions: bigint): boolean {
  if (!c.default_member_permissions) return true;
  const needed = BigInt(c.default_member_permissions);
  return (permissions & ADMINISTRATOR) !== 0n || (permissions & needed) === needed;
}

/** The fields of the /help embed for a caller with these permissions (Discord's bitfield, as a string). */
export function helpFields(permissions: string | undefined): { name: string; value: string }[] {
  const perms = BigInt(permissions ?? "0");
  return HELP_SECTIONS.flatMap(([title, names]) => {
    const lines = names
      .map((n) => commands.get(n))
      .filter((c): c is Command => !!c && allowed(c, perms))
      .map((c) => `\`${usage(c)}\` ${c.description}`);
    if (!lines.length) return [];
    let value = "";
    for (const line of lines) {
      if (value.length + line.length + 1 > FIELD_MAX) break;
      value += (value ? "\n" : "") + line;
    }
    return [{ name: title, value }];
  });
}

export function help(permissions: string | undefined): Response {
  return reply({
    embeds: [{ title: "Bot commands", color: 0x5b9bff, fields: helpFields(permissions), footer: { text: "Only the commands you can use are listed" } }],
    flags: EPHEMERAL,
  });
}
