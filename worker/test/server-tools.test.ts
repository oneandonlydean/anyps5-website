import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { getSetting, setSetting } from "../src/bot/guild";
import { interact, json, mockFetch } from "./helpers";

const API = "https://discord.com/api/v10";
const MODERATE = String(1n << 40n);
const GUILD = {
  id: "g1",
  name: "AnyPS5",
  owner_id: "owner",
  roles: [
    { id: "g1", name: "@everyone", position: 0, permissions: "0" },
    { id: "low", name: "Member", position: 1, permissions: "0" },
    { id: "modrole", name: "Mod", position: 5, permissions: MODERATE },
    { id: "high", name: "Admin", position: 9, permissions: "8" },
  ],
};
const mod = { user: { id: "mod", username: "moddy" }, roles: ["modrole"] };
const target = (roles: string[]) => ({ users: { u1: { id: "u1", username: "target" } }, members: { u1: { roles } } });
const cmd = (name: string, options: unknown[] = [], resolved: unknown = {}, member: unknown = mod) => ({ type: 2, guild_id: "g1", channel_id: "c1", member, data: { name, options, resolved } });
const sub = (name: string, sub: string, options: unknown[] = [], resolved: unknown = {}, member: unknown = mod) => cmd(name, [{ type: 1, name: sub, options }], resolved, member);
const o = (name: string, value: unknown, type = 3) => ({ name, type, value });
const form = (custom_id: string, fields: Record<string, string>, member: unknown = mod) => ({
  type: 5,
  guild_id: "g1",
  channel_id: "c1",
  member,
  data: { custom_id, components: Object.entries(fields).map(([id, value]) => ({ type: 18, component: { type: 4, custom_id: id, value } })) },
});
const ok = () => new Response(null, { status: 204 });
const cases = () => env.DB.prepare("SELECT * FROM cases ORDER BY number").all<any>().then((r) => r.results);

// Moderation.

it("won't let a moderator act on someone whose highest role is the same or above theirs", async () => {
  mockFetch({ [`GET ${API}/guilds/g1`]: () => json(GUILD) });
  const { data } = await interact(cmd("ban", [o("user", "u1", 6)], target(["high"])));
  expect(data.flags).toBe(64);
  expect(data.content).toContain("their highest role is the same as or above yours");
  expect(await cases()).toEqual([]);
});

it("/ban tells the member first, bans, records a case and logs it", async () => {
  await setSetting(env, "g1", "logs", { moderation: "modlog" });
  const calls = mockFetch({
    [`POST ${API}/users/@me/channels`]: () => json({ id: "dm1" }),
    [`POST ${API}/channels/dm1/messages`]: () => json({ id: "m" }),
    [`PUT ${API}/guilds/g1/bans/u1`]: ok,
    [`POST ${API}/channels/modlog/messages`]: () => json({ id: "log" }),
    [`GET ${API}/guilds/g1`]: () => json(GUILD),
  });
  const { data } = await interact(cmd("ban", [o("user", "u1", 6), o("reason", "spamming"), o("delete_messages", 86400, 4)], target(["low"])));
  expect(data.content).toBe("Banned **target** (case 1). They were told by direct message.");
  expect(calls.map((c) => `${c.method} ${c.url.slice(API.length)}`)).toEqual([
    "GET /guilds/g1",
    "POST /users/@me/channels",
    "POST /channels/dm1/messages",
    "PUT /guilds/g1/bans/u1",
    "POST /channels/modlog/messages",
  ]);
  expect(JSON.parse(calls[2]!.body).content).toBe("You were banned from **AnyPS5**.\nReason: spamming");
  expect(JSON.parse(calls[3]!.body)).toEqual({ delete_message_seconds: 86400 });
  expect(JSON.parse(calls[4]!.body).embeds[0]).toMatchObject({ title: "Banned · case 1" });
  expect(await cases()).toMatchObject([{ number: 1, action: "ban", user_id: "u1", moderator_id: "mod", reason: "spamming" }]);
});

it("/warn, /warnings and /unwarn", async () => {
  mockFetch({
    [`GET ${API}/guilds/g1`]: () => json(GUILD),
    [`POST ${API}/users/@me/channels`]: () => json({ message: "Cannot send messages to this user" }, 403),
  });
  expect((await interact(cmd("warn", [o("user", "u1", 6), o("reason", "be nice")], target([])))).data.content).toBe(
    "Warned **target** (case 1). They don't accept direct messages, so they weren't told.",
  );
  await interact(cmd("warn", [o("user", "u1", 6), o("reason", "again")], target([])));

  const listed = (await interact(cmd("warnings", [o("user", "u1", 6)]))).data.content;
  expect(listed).toContain("**2** active warnings, 2 cases in all.");
  expect(listed).toContain("**#2** Warned by <@mod>");

  expect((await interact(cmd("unwarn", [o("case", 1, 4)]))).data.content).toBe("Took back warning 1 for <@u1>: it no longer counts toward automod's warning, timeout, ban ladder.");
  expect((await interact(cmd("warnings", [o("user", "u1", 6)]))).data.content).toContain("**1** active warning, 2 cases");
  expect((await interact(cmd("unwarn", [o("case", 1, 4)]))).data.content).toContain("already taken back");
});

it("/timeout needs a duration it can read, up to 28 days", async () => {
  const calls = mockFetch({
    [`GET ${API}/guilds/g1`]: () => json(GUILD),
    [`PATCH ${API}/guilds/g1/members/u1`]: ok,
    [`POST ${API}/users/@me/channels`]: () => json({}, 403),
  });
  expect((await interact(cmd("timeout", [o("user", "u1", 6), o("duration", "soon")], target([])))).data.content).toContain("like `10m`");
  expect((await interact(cmd("timeout", [o("user", "u1", 6), o("duration", "5w")], target([])))).data.content).toContain("28 days");
  const { data } = await interact(cmd("timeout", [o("user", "u1", 6), o("duration", "1h30m")], target([])));
  expect(data.content).toContain("Timed out **target** for 1 hour 30 minutes (case 1)");
  const until = Date.parse(JSON.parse(calls.find((c) => c.method === "PATCH")!.body).communication_disabled_until);
  expect(until - Date.now()).toBeGreaterThan(5390_000);
  expect(until - Date.now()).toBeLessThan(5410_000);
});

it("/purge bulk deletes recent messages, but not pinned or old ones", async () => {
  const snowflake = (msAgo: number) => ((BigInt(Date.now() - msAgo - 1420070400000) << 22n) + 1n).toString();
  const young = [snowflake(1000), snowflake(2000), snowflake(3000)];
  const calls = mockFetch({
    [`GET ${API}/channels/c1/messages`]: () =>
      json([
        { id: young[0], author: { id: "u1" } },
        { id: young[1], author: { id: "u2" } },
        { id: young[2], author: { id: "u1" }, pinned: true },
        { id: snowflake(20 * 86400_000), author: { id: "u1" } },
      ]),
    [`POST ${API}/channels/c1/messages/bulk-delete`]: ok,
    [`DELETE ${API}/channels/c1/messages/`]: ok,
  });
  expect((await interact(cmd("purge", [o("count", 10, 4)]))).data.content).toContain("Deleted 2 messages. 1 older than 14 days were left");
  expect(JSON.parse(calls[1]!.body)).toEqual({ messages: [young[0], young[1]] });
  expect((await interact(cmd("purge", [o("count", 10, 4), o("user", "u2", 6)]))).data.content).toContain("Deleted 1 message from <@u2>");
  expect(calls.at(-1)!.method).toBe("DELETE");
});

it("/lock denies sending for @everyone, keeping the channel's other overrides, and /unlock undoes it", async () => {
  const SEND = 1n << 11n;
  let overwrites = [{ id: "g1", type: 0, allow: String(SEND | 1024n), deny: "64" }];
  const calls = mockFetch({
    [`GET ${API}/channels/c1`]: () => json({ id: "c1", permission_overwrites: overwrites }),
    [`POST ${API}/channels/c1/messages`]: () => json({ id: "n" }),
    [`PUT ${API}/channels/c1/permissions/g1`]: (c) => {
      overwrites = [{ id: "g1", ...JSON.parse(c.body) }];
      return ok();
    },
  });
  expect((await interact(cmd("lock", [o("reason", "Cooling off")]))).data.content).toContain("Locked <#c1>");
  expect(BigInt(overwrites[0]!.deny) & SEND).toBe(SEND);
  expect(BigInt(overwrites[0]!.deny) & 64n).toBe(64n);
  expect(BigInt(overwrites[0]!.allow)).toBe(1024n);
  expect(JSON.parse(calls[1]!.body).content).toBe("🔒 This channel is locked. Cooling off");
  expect((await interact(cmd("lock"))).data.content).toContain("already locked");

  expect((await interact(cmd("unlock"))).data.content).toBe("Unlocked <#c1>.");
  expect(BigInt(overwrites[0]!.deny)).toBe(64n);
});

// Role panels.

const panelRole = (id: string, permissions = "0", extra = {}) => ({ roles: { [id]: { id, name: `Role ${id}`, position: 1, permissions, ...extra } } });

it("a role panel: created from a form, roles added, and members picking roles", async () => {
  const modalReply = await interact(sub("roles", "create", [o("mode", "unique")]));
  expect(modalReply.type).toBe(9);
  expect(modalReply.data.custom_id).toBe("roles:create:buttons:unique:c1");

  const calls = mockFetch({
    [`POST ${API}/channels/c1/messages`]: () => json({ id: "panelmsg" }),
    [`PATCH ${API}/channels/c1/messages/panelmsg`]: ok,
    [`PUT ${API}/guilds/g1/members/u1/roles/`]: ok,
    [`DELETE ${API}/guilds/g1/members/u1/roles/`]: ok,
  });
  expect((await interact(form("roles:create:buttons:unique:c1", { title: "Platforms", description: "Where you play" }))).data.content).toContain("Posted panel **1**");

  const add = (role: string, permissions = "0", extra: unknown[] = []) =>
    interact(sub("roles", "add", [o("panel", 1, 4), o("role", role, 8), ...extra], panelRole(role, permissions)));
  expect((await add("mods", String(1n << 13n))).data.content).toContain("has moderation or admin permissions");
  expect((await add("linux", "0", [o("emoji", "🐧")])).data.content).toContain("Added <@&linux> on **Platforms**");
  await add("windows");
  const panel = JSON.parse(calls.at(-1)!.body);
  expect(panel.embeds[0].description).toBe("Where you play\n\n🐧 <@&linux>\n• <@&windows>");
  expect(panel.components[0].components.map((b: any) => b.custom_id)).toEqual(["role:1:linux", "role:1:windows"]);
  expect(panel.components[0].components[0].emoji).toEqual({ name: "🐧" });

  const click = (role: string, roles: string[]) =>
    interact({ type: 3, guild_id: "g1", channel_id: "c1", member: { user: { id: "u1", username: "u" }, roles }, data: { custom_id: `role:1:${role}`, component_type: 2 } });
  expect((await click("linux", [])).data.content).toBe("Gave you <@&linux>.");
  // Unique: picking another drops the first.
  expect((await click("windows", ["linux"])).data.content).toBe("Gave you <@&windows>.\nTook away <@&linux>.");
  expect(calls.slice(-2).map((c) => `${c.method} ${c.url.slice(API.length)}`)).toEqual(["PUT /guilds/g1/members/u1/roles/windows", "DELETE /guilds/g1/members/u1/roles/linux"]);
  expect((await click("windows", ["windows"])).data.content).toBe("Took away <@&windows>.");

  const suggestions = await interact({ type: 4, guild_id: "g1", data: { name: "roles", options: [{ type: 1, name: "add", options: [{ name: "panel", type: 4, value: "plat", focused: true }] }] } });
  expect(suggestions.data.choices).toEqual([{ name: "1. Platforms", value: 1 }]);
});

// Tags.

it("tags: saved from a form, posted for everyone, suggested as you type", async () => {
  expect((await interact(sub("tags", "add"))).type).toBe(9);
  expect((await interact(form("tags:add", { name: "Read Me!", content: "Read the **guide** @everyone" }))).data.content).toContain("Saved `read-me`");
  expect((await interact(form("tags:add", { name: "read me", content: "x" }))).data.content).toContain("already a tag called `read-me`");

  const posted = await interact(cmd("tag", [o("name", "read-me")], {}, { user: { id: "anyone", username: "a" }, roles: [] }));
  expect(posted.data).toEqual({ allowed_mentions: { parse: [] }, content: "Read the **guide** @everyone" });
  expect(await env.DB.prepare("SELECT uses FROM tags WHERE name = 'read-me'").first("uses")).toBe(1);

  const suggestions = await interact({ type: 4, guild_id: "g1", data: { name: "tag", options: [{ name: "name", type: 3, value: "rea", focused: true }] } });
  expect(suggestions.data.choices).toEqual([{ name: "read-me", value: "read-me" }]);

  expect((await interact(form("tags:edit:read-me", { content: "New text" }))).data.content).toBe("Updated `read-me`.");
  expect((await interact(sub("tags", "delete", [o("name", "read-me")]))).data.content).toBe("Deleted the tag `read-me`.");
});

// Settings.

it("/logs, /autorole, /automod and /welcome save the server's settings", async () => {
  await interact(sub("logs", "set", [o("type", "messages"), o("channel", "logchan", 7)]));
  expect((await interact(sub("logs", "show"))).data.content).toContain("**Edited and deleted messages:** <#logchan>");

  const role = (id: string, permissions = "0") => ({ roles: { [id]: { id, name: id, position: 1, permissions } } });
  expect((await interact(sub("autorole", "add", [o("role", "admin", 8)], role("admin", "8")))).data.content).toContain("can't be given automatically");
  await interact(sub("autorole", "add", [o("role", "newbie", 8)], role("newbie")));
  expect(await getSetting(env, "g1", "autoroles")).toEqual(["newbie"]);

  expect((await interact(sub("automod", "filter", [o("filter", "caps"), o("action", "warn")]))).data.content).toBe("Unknown action.");
  expect((await interact(sub("automod", "filter", [o("filter", "piracy"), o("action", "answer")]))).data.content).toContain("Only the ETA filter can answer");
  expect((await interact(sub("automod", "filter", [o("filter", "caps"), o("action", "strike"), o("limit", 80, 4)]))).data.content).toContain(
    "(80 percent capitals) and deletes the message and takes a step on the ladder",
  );
  await interact(cmd("automod", [{ type: 2, name: "words", options: [{ type: 1, name: "add", options: [o("words", "Foo, bar ,foo")] }] }]));
  const automod = await getSetting(env, "g1", "automod");
  expect(automod.filters.caps).toEqual({ action: "strike", limit: 80 });
  expect(automod.words).toEqual(["foo", "bar"]);

  const setup = (await interact(sub("automod", "setup"))).data.content;
  expect(setup).toContain("**piracy**");
  expect(setup).toContain("turn off the keyword and regex rules");
  expect((await getSetting(env, "g1", "automod")).filters).toMatchObject({ scam: { action: "strike" }, eta: { action: "answer" }, caps: { action: "strike", limit: 80 } });
  expect((await interact(sub("automod", "test", [o("message", "anyone got the gta 6 pkg?")]))).data.content).toContain("Caught by **piracy**");
  expect((await interact(sub("automod", "test", [o("message", "i mined bitcoin once")]))).data.content).toContain("Not caught.");

  const modal = await interact(sub("welcome", "join", [o("channel", "lobby", 7)]));
  expect(modal.data.custom_id).toBe("settings:welcome:join:lobby");
  await interact(form("settings:welcome:join:lobby", { message: "Hi {user}, welcome to {server}!" }));
  expect(await getSetting(env, "g1", "welcome")).toEqual({ join: { channel: "lobby", message: "Hi {user}, welcome to {server}!" } });
  expect((await interact(sub("welcome", "show"))).data.content).toContain("Hi <@mod>, welcome to this server!");
});
