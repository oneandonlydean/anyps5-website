import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { NO_RULES } from "../src/bot/automod-rules";
import { guildState, handle, type CachedMessage, type Job, type KnownMember, type World } from "../src/bot/events";
import type { Gateway } from "../src/bot/gateway";
import { Bot, DEFAULTS, addCase, type Automod, type Settings } from "../src/bot/guild";
import { runJob } from "../src/bot/jobs";
import { json, mockFetch } from "./helpers";

const API = "https://discord.com/api/v10";
const MANAGE_MESSAGES = String(1n << 13n);
const GUILD = {
  id: "g1",
  name: "AnyPS5",
  owner_id: "owner",
  member_count: 41,
  roles: [
    { id: "g1", name: "@everyone", position: 0, permissions: "0" },
    { id: "mod", name: "Mod", position: 5, permissions: MANAGE_MESSAGES },
  ],
  threads: [{ id: "thread1", parent_id: "quiet" }],
};

/** An in-memory gateway for events.ts. */
function makeWorld(settings: Partial<Settings> = {}) {
  const jobs: { job: Job; delay?: number }[] = [];
  const messages = new Map<string, CachedMessage>();
  const members = new Map<string, KnownMember>();
  const state = guildState(GUILD);
  let t = 1_800_000_000;
  const world: World & { jobs: typeof jobs; tick(s: number): void } = {
    jobs,
    botId: "app123",
    hasSticky: (channel) => channel === "stuck",
    stickyQueued: new Map(),
    tick: (s) => (t += s),
    settings: () => ({ ...structuredClone(DEFAULTS), ...settings }),
    guild: (id) => (id === "g1" ? state : undefined),
    message: (id) => messages.get(id),
    saveMessage: (m) => messages.set(m.id, m),
    member: (g, u) => members.get(`${g}:${u}`),
    saveMember: (g, u, m) => members.set(`${g}:${u}`, m),
    forgetMember: (g, u) => members.delete(`${g}:${u}`),
    enqueue: (job, delay) => jobs.push({ job, ...(delay ? { delay } : {}) }),
    recent: new Map(),
    removedByAutomod: new Map(),
    rules: () => NO_RULES,
    etaAnswer: () => "There's no date.",
    answered: new Map(),
    now: () => t,
  };
  return world;
}

const automod = (filters: Automod["filters"], extra: Partial<Automod> = {}): Automod => ({ ...structuredClone(DEFAULTS.automod), filters, ...extra });
const message = (content: string, extra: Record<string, unknown> = {}) => ({
  id: `m${Math.random()}`,
  guild_id: "g1",
  channel_id: "general",
  content,
  author: { id: "u1", username: "member" },
  member: { roles: [] },
  ...extra,
});
it("automod deletes and notifies, or strikes, and leaves moderators, bots and ignored channels alone", () => {
  const world = makeWorld({ automod: automod({ invites: { action: "delete" }, scam: { action: "strike" } }, { ignoredChannels: ["quiet"], rulesChannel: "rules" }) });

  handle(world, "MESSAGE_CREATE", message("discord.gg/x", { member: { roles: ["mod"] } }));
  handle(world, "MESSAGE_CREATE", message("discord.gg/x", { author: { id: "b", username: "bot", bot: true } }));
  handle(world, "MESSAGE_CREATE", message("discord.gg/x", { channel_id: "thread1" }));
  expect(world.jobs).toEqual([]);

  handle(world, "MESSAGE_CREATE", message("discord.gg/x", { id: "spam1" }));
  expect(world.jobs).toEqual([
    { job: { kind: "delete", channel: "general", message: "spam1", reason: "Automod (invites): invites to other servers aren't allowed here" } },
    { job: { kind: "post", channel: "general", message: { content: "<@u1>, your message was removed: invites to other servers aren't allowed here.", allowed_mentions: { users: ["u1"] } }, expires: 8 } },
  ]);

  world.jobs.length = 0;
  handle(world, "MESSAGE_CREATE", message("Free airdrop, connect your wallet now", { id: "w1" }));
  expect(world.jobs.map((j) => j.job.kind)).toEqual(["delete", "strike"]);
  expect(world.jobs[1]!.job).toMatchObject({ filter: "scam", severe: false, server: "AnyPS5", rules: "rules", minutes: 1440, channel: "general", user: { id: "u1" } });
});

it("a message edited into spam is caught, and a forwarded one is read too", () => {
  const world = makeWorld({ automod: automod({ scam: { action: "strike" } }) });
  handle(world, "MESSAGE_CREATE", message("hello everyone", { id: "e1" }));
  handle(world, "MESSAGE_UPDATE", { ...message("hello everyone, claim your reward at our presale", { id: "e1" }), edited_timestamp: "2026-01-01" });
  expect(world.jobs.map((j) => j.job.kind)).toEqual(["delete", "strike"]);

  world.jobs.length = 0;
  handle(world, "MESSAGE_CREATE", message("", { id: "f1", message_snapshots: [{ message: { content: "seed phrase giveaway, connect wallet" } }] }));
  expect(world.jobs.map((j) => j.job.kind)).toEqual(["delete", "strike"]);
});

it("the same message in three channels is a hacked account: every copy goes, and it skips the warning", () => {
  const world = makeWorld({ automod: automod({ crosspost: { action: "strike", limit: 3 } }) });
  handle(world, "MESSAGE_CREATE", message("check out this cool thing", { id: "a", channel_id: "c1" }));
  handle(world, "MESSAGE_CREATE", message("check out this cool thing", { id: "b", channel_id: "c2" }));
  expect(world.jobs).toEqual([]);
  handle(world, "MESSAGE_CREATE", message("check out this cool thing", { id: "c", channel_id: "c3" }));
  expect(world.jobs.filter((j) => j.job.kind === "delete").map((j) => (j.job as any).message)).toEqual(["c", "a", "b"]);
  expect(world.jobs.at(-1)!.job).toMatchObject({ kind: "strike", filter: "crosspost", severe: true });
});

it("ETA questions are removed and answered, at most every 3 minutes per channel", () => {
  const world = makeWorld({ automod: automod({ eta: { action: "answer" } }) });
  handle(world, "MESSAGE_CREATE", message("when will gta 6 work?", { id: "q1" }));
  expect(world.jobs.map((j) => j.job)).toEqual([
    { kind: "delete", channel: "general", message: "q1", reason: "Automod (eta): there's no date for that (rule 3)" },
    { kind: "post", channel: "general", message: { content: "<@u1> There's no date.", allowed_mentions: { users: ["u1"] }, flags: 4 } },
  ]);
  world.tick(60);
  handle(world, "MESSAGE_CREATE", message("eta for ps5 games?", { id: "q2", author: { id: "u2", username: "other" } }));
  expect(world.jobs.slice(2).map((j) => j.job.kind)).toEqual(["delete"]);
  world.tick(200);
  handle(world, "MESSAGE_CREATE", message("how long until ps5 games are playable", { id: "q3", author: { id: "u3", username: "third" } }));
  expect(world.jobs.slice(3).map((j) => j.job.kind)).toEqual(["delete", "post"]);
});

it("logs edits and deletions with what the message said, and notes automod's deletions", () => {
  const world = makeWorld({ logs: { messages: "log" }, automod: automod({ invites: { action: "delete" } }) });
  handle(world, "MESSAGE_CREATE", message("first", { id: "e1" }));
  handle(world, "MESSAGE_UPDATE", { id: "e1", guild_id: "g1", channel_id: "general", content: "first", edited_timestamp: null });
  expect(world.jobs).toEqual([]);
  handle(world, "MESSAGE_UPDATE", { id: "e1", guild_id: "g1", channel_id: "general", content: "second", edited_timestamp: "2026-01-01" });
  const edit = (world.jobs[0]!.job as any).message.embeds[0];
  expect(edit.fields).toEqual([
    { name: "Before", value: "first" },
    { name: "After", value: "second" },
  ]);
  expect(edit.description).toContain("https://discord.com/channels/g1/general/e1");

  world.jobs.length = 0;
  handle(world, "MESSAGE_DELETE", { id: "e1", guild_id: "g1", channel_id: "general" });
  expect((world.jobs[0]!.job as any).message.embeds[0].description).toBe("**A message from <@u1> was deleted in <#general>**\nsecond");

  world.jobs.length = 0;
  handle(world, "MESSAGE_CREATE", message("discord.gg/x", { id: "a1" }));
  handle(world, "MESSAGE_DELETE", { id: "a1", guild_id: "g1", channel_id: "general" });
  expect((world.jobs.at(-1)!.job as any).message.embeds[0].description).toContain("deleted in <#general> by automod (invites to other servers aren't allowed here)");

  world.jobs.length = 0;
  handle(world, "MESSAGE_DELETE", { id: "never-seen", guild_id: "g1", channel_id: "general" });
  expect(world.jobs).toEqual([]);
});

it("welcomes new members and gives their roles, after they accept the rules if they must", () => {
  const world = makeWorld({ logs: { members: "memberlog" }, welcome: { join: { channel: "lobby", message: "Hi {user}, member #{count} of {server}" } }, autoroles: ["newbie"] });
  const user = { id: "1300000000000000000", username: "newcomer" };
  handle(world, "GUILD_MEMBER_ADD", { guild_id: "g1", user, roles: [] });
  expect(world.jobs.map((j) => j.job)).toEqual([
    expect.objectContaining({ kind: "post", channel: "memberlog" }),
    { kind: "post", channel: "lobby", message: { content: "Hi <@1300000000000000000>, member #42 of AnyPS5", allowed_mentions: { users: ["1300000000000000000"] } } },
    { kind: "role", guild: "g1", user: "1300000000000000000", role: "newbie", reason: "Autorole for new members" },
  ]);

  world.jobs.length = 0;
  handle(world, "GUILD_MEMBER_ADD", { guild_id: "g1", user: { id: "2", username: "screened" }, roles: [], pending: true });
  expect(world.jobs.map((j) => j.job.kind)).toEqual(["post"]);
  handle(world, "GUILD_MEMBER_UPDATE", { guild_id: "g1", user: { id: "2", username: "screened" }, roles: [], pending: false });
  expect(world.jobs.slice(1).map((j) => j.job.kind)).toEqual(["post", "role"]);
});

it("logs nickname and role changes, and leaving with the roles they had", () => {
  const world = makeWorld({ logs: { members: "memberlog" }, welcome: { leave: { channel: "lobby", message: "{username} left" } } });
  const user = { id: "5", username: "someone" };
  handle(world, "GUILD_MEMBERS_CHUNK", { guild_id: "g1", members: [{ user, roles: ["a"], nick: null }] });
  handle(world, "GUILD_MEMBER_UPDATE", { guild_id: "g1", user, roles: ["b"], nick: "Nick" });
  expect((world.jobs[0]!.job as any).message.embeds[0].description).toBe("**<@5> was updated**\nNickname: _none_ → **Nick**\nGot <@&b>\nLost <@&a>");
  handle(world, "GUILD_MEMBER_REMOVE", { guild_id: "g1", user });
  expect((world.jobs[1]!.job as any).message.embeds[0].description).toBe("**<@5> left**\nRoles: <@&b>");
  expect(world.jobs[2]!.job).toEqual({ kind: "post", channel: "lobby", message: { content: "someone left" } });
});

// Jobs.

const strikeJob = (severe = false): Job => ({
  kind: "strike",
  guild: "g1",
  server: "AnyPS5",
  channel: "general",
  user: { id: "u1", username: "member" },
  filter: "piracy",
  why: "asking for or sharing games, keys or firmware isn't allowed (rule 1)",
  severe,
  rules: "rules",
  minutes: 1440,
});
/** Moves every case back in time, past the cooldown that makes a burst of messages one strike. */
const later = () => env.DB.prepare("UPDATE cases SET created_at = created_at - 300").run();

it("the warning ladder: one public warning, then a 24-hour timeout, then a ban", async () => {
  await env.DB.prepare("INSERT INTO guild_settings VALUES ('g1', 'logs', '{\"moderation\":\"modlog\"}', 0)").run();
  const calls = mockFetch({
    [`PATCH ${API}/guilds/g1/members/u1`]: () => new Response(null, { status: 204 }),
    [`PUT ${API}/guilds/g1/bans/u1`]: () => new Response(null, { status: 204 }),
    [`POST ${API}/users/@me/channels`]: () => json({ id: "dm" }),
    [`POST ${API}/channels/`]: () => json({ id: "x" }),
  });
  const said = () => calls.filter((c) => c.url === `${API}/channels/general/messages`).map((c) => JSON.parse(c.body).content);

  await runJob(new Bot(env), strikeJob());
  expect(said()).toEqual([
    "⚠️ <@u1>, your message was removed: asking for or sharing games, keys or firmware isn't allowed (rule 1).\nThis is your only warning. Next time is a 1 day timeout, and after that a ban. Please read <#rules>.",
  ]);
  // A second message in the same burst is only deleted.
  await runJob(new Bot(env), strikeJob());
  expect(said()).toHaveLength(1);

  await later();
  await runJob(new Bot(env), strikeJob());
  expect(said()[1]).toBe("🔇 <@u1> was timed out for 1 day: asking for or sharing games, keys or firmware isn't allowed (rule 1). They had been warned. Next time is a ban. Please read <#rules>.");
  const until = Date.parse(JSON.parse(calls.find((c) => c.method === "PATCH")!.body).communication_disabled_until);
  expect(Math.round((until - Date.now()) / 3600_000)).toBe(24);

  await later();
  await runJob(new Bot(env), strikeJob());
  expect(said()[2]).toBe("🔨 <@u1> was banned: asking for or sharing games, keys or firmware isn't allowed (rule 1), after a warning and a timeout.");
  expect(JSON.parse(calls.find((c) => c.method === "PUT")!.body)).toEqual({ delete_message_seconds: 3600 });
  const cases = (await env.DB.prepare("SELECT action, moderator_id FROM cases ORDER BY number").all()).results;
  expect(cases).toEqual([
    { action: "warn", moderator_id: "app123" },
    { action: "timeout", moderator_id: "app123" },
    { action: "ban", moderator_id: "app123" },
  ]);
  expect(calls.filter((c) => c.url.endsWith("/channels/modlog/messages"))).toHaveLength(3);
});

it("a severe case skips the warning, and a taken-back warning doesn't count", async () => {
  mockFetch({
    [`PATCH ${API}/guilds/g1/members/u1`]: () => new Response(null, { status: 204 }),
    [`POST ${API}/users/@me/channels`]: () => json({}, 403),
    [`POST ${API}/channels/`]: () => json({ id: "x" }),
  });
  await runJob(new Bot(env), strikeJob(true));
  expect(await env.DB.prepare("SELECT action FROM cases").first("action")).toBe("timeout");

  await env.DB.prepare("DELETE FROM cases").run();
  await addCase(env, { guild_id: "g1", action: "warn", user_id: "u1", moderator_id: "mod", reason: "old", duration: null });
  await env.DB.prepare("UPDATE cases SET active = 0, created_at = created_at - 300").run();
  await runJob(new Bot(env), strikeJob());
  expect((await env.DB.prepare("SELECT action FROM cases ORDER BY number").all()).results.map((c: any) => c.action)).toEqual(["warn", "warn"]);
});

it("a ban from outside the bot becomes a case naming who did it, from the audit log", async () => {
  const user = { id: "u1", username: "member" };
  const calls = mockFetch({
    [`GET ${API}/guilds/g1/audit-logs`]: () => json({ audit_log_entries: [{ target_id: "other", user_id: "x" }, { target_id: "u1", user_id: "admin", reason: "raid" }] }),
  });
  await runJob(new Bot(env), { kind: "ban", guild: "g1", user, banned: true });
  expect(await env.DB.prepare("SELECT action, moderator_id, reason FROM cases").first()).toEqual({ action: "ban", moderator_id: "admin", reason: "raid" });

  // The bot's own /ban already made the case.
  await addCase(env, { guild_id: "g1", action: "ban", user_id: "u2", moderator_id: "mod", reason: null, duration: null });
  await runJob(new Bot(env), { kind: "ban", guild: "g1", user: { id: "u2", username: "x" }, banned: true });
  expect(calls).toHaveLength(1);
});

it("a job Discord refuses for good is dropped; one that fails for now is retried", async () => {
  mockFetch({ [`POST ${API}/channels/gone/messages`]: () => json({}, 403), [`POST ${API}/channels/down/messages`]: () => json({}, 503) });
  await expect(runJob(new Bot(env), { kind: "post", channel: "gone", message: { content: "x" } })).resolves.toEqual([]);
  await expect(runJob(new Bot(env), { kind: "post", channel: "down", message: { content: "x" } })).rejects.toThrow("503");
});

it("the gateway's queue runs jobs from an alarm, schedules follow-ups, and retries failures later", async () => {
  const calls = mockFetch({
    [`POST ${API}/channels/ok/messages`]: () => json({ id: "notice" }),
    [`POST ${API}/channels/down/messages`]: () => json({}, 500),
  });
  const stub = env.GATEWAY!.getByName("test");
  await runInDurableObject(stub, async (gateway: Gateway, state) => {
    gateway.enqueue({ kind: "post", channel: "ok", message: { content: "Removed" }, expires: 8 });
    gateway.enqueue({ kind: "post", channel: "down", message: { content: "x" } });
    await gateway.alarm();
    const rows = state.storage.sql.exec<{ job: string; attempts: number; run_at: number }>("SELECT job, attempts, run_at FROM outbox ORDER BY id").toArray();
    expect(rows.map((r) => [JSON.parse(r.job).kind, r.attempts])).toEqual([
      ["post", 1],
      ["delete", 0],
    ]);
    expect(rows.every((r) => r.run_at > Date.now() + 5000)).toBe(true);
    expect(gateway.status()).toMatchObject({ connected: false, queued: 2 });
  });
  expect(calls.filter((c) => c.url.endsWith("/channels/ok/messages"))).toHaveLength(1);
});

it("a message in a sticky channel moves the sticky down a few seconds later, once per burst", () => {
  const world = makeWorld();
  handle(world, "MESSAGE_CREATE", message("hi", { channel_id: "stuck" }));
  handle(world, "MESSAGE_CREATE", message("hi again", { channel_id: "stuck" }));
  handle(world, "MESSAGE_CREATE", message("announcement", { channel_id: "stuck", webhook_id: "w", author: { id: "w", username: "hook", bot: true } }));
  handle(world, "MESSAGE_CREATE", message("elsewhere", { channel_id: "general" }));
  expect(world.jobs).toEqual([{ job: { kind: "sticky", channel: "stuck" }, delay: 3 }]);
  world.tick(3);
  handle(world, "MESSAGE_CREATE", message("the sticky itself", { channel_id: "stuck", author: { id: "app123", username: "bot", bot: true } }));
  expect(world.jobs).toHaveLength(1);
  handle(world, "MESSAGE_CREATE", message("later", { channel_id: "stuck" }));
  expect(world.jobs).toHaveLength(2);
});

it("the sticky job moves the sticky only when something is below it", async () => {
  await env.DB.prepare("INSERT INTO stickies VALUES ('stuck', 'g1', 'Rules', 's1', 0, 'admin', 0)").run();
  let last = "s1";
  const calls = mockFetch({
    [`GET ${API}/channels/stuck`]: () => json({ id: "stuck", last_message_id: last }),
    [`POST ${API}/channels/stuck/messages`]: () => json({ id: "s2" }),
    [`DELETE ${API}/channels/stuck/messages/s1`]: () => new Response(null, { status: 204 }),
  });
  await runJob(new Bot(env), { kind: "sticky", channel: "stuck" });
  expect(calls).toHaveLength(1);
  last = "someone";
  await runJob(new Bot(env), { kind: "sticky", channel: "stuck" });
  expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST", "DELETE"]);
  expect(await env.DB.prepare("SELECT message_id FROM stickies").first("message_id")).toBe("s2");
});

const until = async (check: () => unknown, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
};

it("the gateway identifies, follows Discord's events, and stops on disallowed intents", async () => {
  await env.DB.prepare(`INSERT INTO guild_settings VALUES ('g1', 'automod', '{"filters":{"invites":{"action":"delete"}}}', 0)`).run();
  const sent: any[] = [];
  let discord!: WebSocket;
  const calls = mockFetch({
    "GET https://gateway.discord.gg/": () => {
      const [client, server] = Object.values(new WebSocketPair());
      server!.accept();
      server!.addEventListener("message", (e) => sent.push(JSON.parse(e.data as string)));
      discord = server!;
      return new Response(null, { status: 101, webSocket: client });
    },
    [`DELETE ${API}/channels/general/messages/bad`]: () => new Response(null, { status: 204 }),
    [`POST ${API}/channels/general/messages`]: () => json({ id: "notice" }),
  });
  const event = (s: number, t: string, d: unknown) => discord.send(JSON.stringify({ op: 0, s, t, d }));

  await runInDurableObject(env.GATEWAY!.getByName("live"), async (gateway: Gateway) => {
    await gateway.ensure();
    discord.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
    await until(() => sent.length);
    expect(sent[0]).toEqual({ op: 2, d: { token: "bot-token", intents: 33287, properties: { os: "linux", browser: "anyps5-bot", device: "anyps5-bot" } } });

    event(1, "READY", { session_id: "sess", resume_gateway_url: "wss://resume.discord.gg", guilds: [{ id: "g1" }] });
    event(2, "GUILD_CREATE", GUILD);
    await until(() => sent.some((p) => p.op === 8));
    expect(sent.find((p) => p.op === 8)).toEqual({ op: 8, d: { guild_id: "g1", query: "", limit: 0 } });

    event(3, "MESSAGE_CREATE", message("join discord.gg/abc", { id: "bad" }));
    await until(() => calls.some((c) => c.method === "DELETE"));
    expect(gateway.status()).toMatchObject({ connected: true, session: true, guilds: 1 });

    discord.close(4014, "Disallowed intent(s)");
    await until(() => gateway.status().stopped);
    expect(gateway.status()).toMatchObject({ connected: false, stopped: expect.stringContaining("closed with 4014") });
    // Paused: the next minute doesn't try again.
    await gateway.ensure();
    expect(calls.filter((c) => c.url.startsWith("https://gateway.discord.gg/"))).toHaveLength(1);
  });
});
