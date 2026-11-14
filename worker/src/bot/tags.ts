import { now, type Env } from "./env";
import { AUTOCOMPLETE_RESULT, focused, modal, privately, publicly, subcommand, submitted, text, type Interaction } from "./guild";

/**
 * Tags, Carl-bot's saved replies: moderators save one with /tags add, and anyone posts it with /tag <name>, for the
 * whole channel to see. Mentions in a tag never ping.
 */

const MAX_TAGS = 200;
const MAX_LENGTH = 2000;

interface Tag {
  guild_id: string;
  name: string;
  content: string;
  author_id: string;
  uses: number;
}

/** Tag names are lowercase words joined by dashes, so they're easy to type. */
export const tagName = (input: string) =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

const get = (env: Env, guild: string, name: string) => env.DB.prepare("SELECT * FROM tags WHERE guild_id = ? AND name = ?").bind(guild, name).first<Tag>();

/** /tag <name>: posts the tag for everyone. */
export async function tag(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  if (!guild) return privately("Use this in a server.");
  const name = tagName(text(i.data?.options ?? [], "name"));
  const found = await get(env, guild, name);
  if (!found) return privately(`There's no tag called \`${name}\`. \`/tags list\` shows them all.`);
  await env.DB.prepare("UPDATE tags SET uses = uses + 1 WHERE guild_id = ? AND name = ?").bind(guild, name).run();
  return publicly(found.content);
}

/** /tags add|edit|delete|list. */
export async function tagsCommand(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  if (!guild) return privately("Use this in a server.");
  const { name: sub, options } = subcommand(i);

  if (sub === "add") {
    return modal("tags:add", "New tag", [
      { id: "name", label: "Name", description: "What people type after /tag. Letters, numbers and dashes.", max: 32 },
      { id: "content", label: "Reply", description: "Markdown, links and emoji work; mentions don't ping.", long: true, max: MAX_LENGTH },
    ]);
  }
  if (sub === "list") {
    const { results } = await env.DB.prepare("SELECT name, uses FROM tags WHERE guild_id = ? ORDER BY name").bind(guild).all<{ name: string; uses: number }>();
    if (!results.length) return privately("No tags yet. Add one with `/tags add`.");
    return privately(`**${results.length} tag${results.length === 1 ? "" : "s"}:** ${results.map((t) => `\`${t.name}\``).join(", ")}`.slice(0, 2000));
  }

  const name = tagName(text(options, "name"));
  const found = await get(env, guild, name);
  if (!found) return privately(`There's no tag called \`${name}\`.`);
  if (sub === "edit") {
    return modal(`tags:edit:${name}`, `Edit ${name}`, [{ id: "content", label: "Reply", long: true, max: MAX_LENGTH, value: found.content }]);
  }
  if (sub === "delete") {
    await env.DB.prepare("DELETE FROM tags WHERE guild_id = ? AND name = ?").bind(guild, name).run();
    return privately(`Deleted the tag \`${name}\`.`);
  }
  return privately("Unknown command.");
}

/** The forms from /tags add and /tags edit. */
export async function tagsSubmit(env: Env, i: Interaction): Promise<Response> {
  const guild = i.guild_id;
  const caller = i.member?.user.id;
  if (!guild || !caller) return privately("Use this in a server.");
  const [, kind, editing] = (i.data?.custom_id ?? "").split(":");
  const content = submitted(i.data?.components, "content")?.trim() ?? "";
  if (!content) return privately("A tag needs a reply.");

  if (kind === "add") {
    const name = tagName(submitted(i.data?.components, "name") ?? "");
    if (!name) return privately("Give the tag a name with letters or numbers in it.");
    if (await get(env, guild, name)) return privately(`There's already a tag called \`${name}\`. Change it with \`/tags edit\`.`);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM tags WHERE guild_id = ?").bind(guild).first<number>("n");
    if ((count ?? 0) >= MAX_TAGS) return privately(`This server has ${MAX_TAGS} tags, the most it can have. Delete one first.`);
    await env.DB.prepare("INSERT INTO tags (guild_id, name, content, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(guild, name, content, caller, now(), now())
      .run();
    return privately(`Saved \`${name}\`. Anyone can post it with \`/tag ${name}\`.`);
  }
  if (kind === "edit" && editing) {
    const { meta } = await env.DB.prepare("UPDATE tags SET content = ?, updated_at = ? WHERE guild_id = ? AND name = ?").bind(content, now(), guild, editing).run();
    return privately(meta.changes ? `Updated \`${editing}\`.` : `The tag \`${editing}\` was deleted in the meantime.`);
  }
  return privately("Unknown form.");
}

export async function suggestTags(env: Env, i: Interaction): Promise<Response> {
  const typed = tagName(String(focused(i.data?.options)?.value ?? ""));
  const { results } = await env.DB.prepare("SELECT name FROM tags WHERE guild_id = ? AND name LIKE ? ORDER BY uses DESC, name LIMIT 25")
    .bind(i.guild_id ?? "", `%${typed}%`)
    .all<{ name: string }>();
  return Response.json({ type: AUTOCOMPLETE_RESULT, data: { choices: results.map((t) => ({ name: t.name, value: t.name })) } });
}
