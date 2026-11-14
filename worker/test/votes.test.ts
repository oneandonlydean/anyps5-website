import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { makeCtx } from "../src/bot/env";
import { setSetting } from "../src/bot/guild";
import { closeVotes } from "../src/bot/votes";
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
    { id: "regular", name: "Regular", position: 2, permissions: "0" },
    { id: "modrole", name: "Mod", position: 5, permissions: MODERATE },
  ],
};
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
const member = (id: string, extra: Record<string, unknown> = {}) => ({ user: { id, username: id }, roles: ["low"], joined_at: daysAgo(30), permissions: "0", ...extra });
const target = (roles = ["low"]) => ({ users: { bad: { id: "bad", username: "baddie" } }, members: { bad: { roles, joined_at: daysAgo(3) } } });
const votekick = (action = "ban", by = member("alice"), resolved: unknown = target()) => ({
  type: 2,
  guild_id: "g1",
  channel_id: "c1",
  member: by,
  data: {
    name: "votekick",
    options: [
      { name: "user", type: 6, value: "bad" },
      { name: "action", type: 3, value: action },
      { name: "reason", type: 3, value: "posting scam links" },
    ],
    resolved,
  },
});
const click = (vote: number, choice: string, by: unknown) => ({ type: 3, guild_id: "g1", channel_id: "c1", member: by, message: { id: "vm" }, data: { custom_id: `vote:${vote}:${choice}`, component_type: 2 } });
const ok = () => new Response(null, { status: 204 });
const vote = () => env.DB.prepare("SELECT * FROM votes").first<any>();
const cases = () => env.DB.prepare("SELECT * FROM cases ORDER BY number").all<any>().then((r) => r.results);
const on = () => setSetting(env, "g1", "votes", { enabled: true, needed: 5, modRole: "modrole", channels: [] });

async function started(action = "ban") {
  await on();
  mockFetch({ [`GET ${API}/guilds/g1`]: () => json(GUILD), [`POST ${API}/channels/c1/messages`]: () => json({ id: "vm" }) });
  await interact(votekick(action));
  return (await vote()).id as number;
}

it("is off until an admin turns it on", async () => {
  const { data } = await interact(votekick());
  expect(data.flags).toBe(64);
  expect(data.content).toBe("Community votes are off in this server.");
});

it("/votekicks on saves the setup, and channel toggles where votes can start", async () => {
  const sub = (name: string, options: unknown[] = []) => ({ type: 2, guild_id: "g1", channel_id: "c1", member: member("admin"), data: { name: "votekicks", options: [{ type: 1, name, options }] } });
  let { data } = await interact(sub("on", [{ name: "mod_role", type: 8, value: "modrole" }, { name: "votes", type: 4, value: 3 }]));
  expect(data.content).toContain("Community votes are **on**.");
  expect(data.content).toContain("Passes at **3** yes votes");
  ({ data } = await interact(sub("channel", [{ name: "channel", type: 7, value: "c9" }])));
  expect(data.content).toContain("Channels: <#c9>");
  ({ data } = await interact(votekick()));
  expect(data.content).toBe("Votes can only be started in <#c9>.");
});

it("starts a vote: posts it with buttons, pings the mod role, and counts the starter's yes", async () => {
  await on();
  const calls = mockFetch({ [`GET ${API}/guilds/g1`]: () => json(GUILD), [`POST ${API}/channels/c1/messages`]: () => json({ id: "vm" }) });
  const { data } = await interact(votekick());
  expect(data.flags).toBe(64);
  expect(data.content).toContain("Vote started");
  const post = JSON.parse(calls.find((c) => c.method === "POST")!.body);
  expect(post.content).toContain("<@&modrole>");
  expect(post.allowed_mentions).toEqual({ parse: [], roles: ["modrole"] });
  expect(post.embeds[0].title).toBe("Vote to ban for 2 weeks: baddie");
  expect(post.embeds[0].description).toContain("**1** for · **0** against · needs **5**");
  expect(post.components[0].components.map((b: any) => b.custom_id)).toEqual(["vote:1:yes", "vote:1:no", "vote:1:cancel"]);
  expect(await vote()).toMatchObject({ message_id: "vm", status: "open", action: "ban", needed: 5 });
});

it("won't let new members start votes, or anyone vote on a moderator or someone already being voted on", async () => {
  await on();
  mockFetch({ [`GET ${API}/guilds/g1`]: () => json(GUILD), [`POST ${API}/channels/c1/messages`]: () => json({ id: "vm" }) });
  let { data } = await interact(votekick("ban", member("newbie", { joined_at: daysAgo(10) })));
  expect(data.content).toBe("You can start a vote once you've been in the server for 2 weeks.");
  ({ data } = await interact(votekick("ban", member("alice"), target(["modrole"]))));
  expect(data.content).toContain("moderators can't be voted on");
  await interact(votekick());
  ({ data } = await interact(votekick("timeout", member("bob"))));
  expect(data.content).toBe("There's already a vote on **baddie**.");
  ({ data } = await interact(votekick("ban", member("alice"), { users: { bad: { id: "bad", username: "baddie" } }, members: { bad: { roles: ["low"] } } })));
  expect(data.content).toBe("There's already a vote on **baddie**.");
});

it("passes at 5 yes votes: tells them, bans for 2 weeks, records a case and logs who voted", async () => {
  const id = await started();
  await setSetting(env, "g1", "logs", { moderation: "modlog" });
  const calls = mockFetch({
    [`GET ${API}/guilds/g1`]: () => json(GUILD),
    [`POST ${API}/users/@me/channels`]: () => json({ id: "dm1" }),
    [`POST ${API}/channels/dm1/messages`]: () => json({ id: "m" }),
    [`PUT ${API}/guilds/g1/bans/bad`]: ok,
    [`POST ${API}/channels/modlog/messages`]: () => json({ id: "log" }),
  });

  let res = await interact(click(id, "yes", member("newbie", { joined_at: daysAgo(3) })));
  expect(res.data.content).toBe("You can vote once you've been in the server for 2 weeks.");
  res = await interact(click(id, "yes", member("bad")));
  expect(res.data.content).toBe("You can't vote on yourself.");

  for (const voter of ["b", "c", "d"]) {
    res = await interact(click(id, "yes", member(voter)));
    expect(res.type).toBe(7);
  }
  expect(calls).toEqual([]);
  expect(res.data.embeds[0].description).toContain("**4** for");
  res = await interact(click(id, "yes", member("e")));

  expect(res.data.components).toEqual([]);
  expect(res.data.embeds[0].description).toContain("Passed (5 for, 0 against): **baddie** is banned for 2 weeks (case 1).");
  const ban = calls.find((c) => c.method === "PUT")!;
  expect(JSON.parse(ban.body)).toEqual({ delete_message_seconds: 3600 });
  expect(calls.map((c) => `${c.method} ${c.url.slice(API.length)}`).indexOf("POST /channels/dm1/messages")).toBeLessThan(calls.indexOf(ban));
  expect(JSON.parse(calls.find((c) => c.url.endsWith("/channels/dm1/messages"))!.body).content).toContain("You were banned for 2 weeks from **AnyPS5**.");
  expect(await cases()).toMatchObject([{ action: "ban", user_id: "bad", moderator_id: "vote", duration: 14 * 86400, reason: "Community vote (5 for, 0 against): posting scam links" }]);
  const log = JSON.parse(calls.find((c) => c.url.endsWith("/channels/modlog/messages"))!.body).embeds[0];
  expect(log.fields.find((f: any) => f.name === "Moderator").value).toBe("A community vote");
  expect(log.fields.find((f: any) => f.name === "Voted for").value).toBe("<@alice> <@b> <@c> <@d> <@e>");
  expect((await vote()).lift_at).toBeGreaterThan(Date.now() / 1000 + 13 * 86400);

  // A late click only shows the result.
  res = await interact(click(id, "yes", member("f")));
  expect(res.data.embeds[0].description).toContain("Passed (5 for");
  expect((await cases()).length).toBe(1);
});

it("needs twice as many yes as no, and a member can change their vote", async () => {
  const id = await started("timeout");
  const calls = mockFetch({ [`GET ${API}/guilds/g1`]: () => json(GUILD), [`PATCH ${API}/guilds/g1/members/bad`]: ok, [`POST ${API}/users/@me/channels`]: () => json({ id: "dm1" }), [`POST ${API}/channels/dm1/messages`]: () => json({ id: "m" }) });
  for (const v of ["n1", "n2", "n3"]) await interact(click(id, "no", member(v)));
  for (const v of ["y1", "y2", "y3", "y4"]) await interact(click(id, "yes", member(v)));
  expect((await vote()).status).toBe("open"); // 5 for, 3 against
  await interact(click(id, "yes", member("n3"))); // 6 for, 2 against
  expect((await vote()).status).toBe("passed");
  const until = Date.parse(JSON.parse(calls.find((c) => c.method === "PATCH")!.body).communication_disabled_until);
  expect(until - Date.now()).toBeGreaterThan(23.9 * 3600_000);
  expect(await cases()).toMatchObject([{ action: "timeout", duration: 86400 }]);
});

it("a moderator can cancel a vote; nobody else can", async () => {
  const id = await started();
  let { data } = await interact(click(id, "cancel", member("b")));
  expect(data.content).toBe("Only a moderator can cancel a vote.");
  const res = await interact(click(id, "cancel", member("m", { roles: ["modrole"] })));
  expect(res.data.embeds[0].description).toContain("Cancelled by <@m>.");
  expect(res.data.components).toEqual([]);
  expect(await vote()).toMatchObject({ status: "cancelled" });
  ({ data } = await interact(votekick("ban", member("bob"))));
  expect(data.content).toContain("ended in the last hour");
});

it("the cron closes votes that ran out, and lifts the ban after 2 weeks unless a moderator acted since", async () => {
  const id = await started();
  await env.DB.prepare("UPDATE votes SET ends_at = 0 WHERE id = ?").bind(id).run();
  let calls = mockFetch({ [`PATCH ${API}/channels/c1/messages/vm`]: () => json({ id: "vm" }) });
  await closeVotes(await makeCtx(env));
  expect(await vote()).toMatchObject({ status: "failed", result: "Not enough votes: 1 for, 0 against." });
  expect(JSON.parse(calls[0]!.body).components).toEqual([]);

  await env.DB.prepare("UPDATE votes SET status = 'passed', case_number = 1, lift_at = 1 WHERE id = ?").bind(id).run();
  await env.DB.prepare("INSERT INTO cases (guild_id, number, action, user_id, moderator_id, duration, created_at) VALUES ('g1', 1, 'ban', 'bad', 'vote', 1209600, 1)").run();
  calls = mockFetch({ [`DELETE ${API}/guilds/g1/bans/bad`]: ok });
  await closeVotes(await makeCtx(env));
  expect(calls).toHaveLength(1);
  expect((await cases())[1]).toMatchObject({ action: "unban", moderator_id: "vote", reason: "The 2-week ban from case 1 ended" });
  expect((await vote()).lift_at).toBeNull();

  // A moderator banned them again since: the ban stays.
  await env.DB.prepare("UPDATE votes SET lift_at = 1 WHERE id = ?").bind(id).run();
  await env.DB.prepare("INSERT INTO cases (guild_id, number, action, user_id, moderator_id, created_at) VALUES ('g1', 3, 'ban', 'bad', 'mod', 2)").run();
  calls = mockFetch({});
  await closeVotes(await makeCtx(env));
  expect(calls).toEqual([]);
  expect((await vote()).lift_at).toBeNull();
});
