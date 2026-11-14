import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { makeCtx } from "../src/bot/env";
import { refreshStickies } from "../src/bot/sticky";
import worker from "../src/index";
import { ctx, json, mockFetch } from "./helpers";

const API = "https://discord.com/api/v10";
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

let keys: CryptoKeyPair;
let testEnv: typeof env;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  testEnv = { ...env, DISCORD_PUBLIC_KEY: hex((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer) };
});

async function send(interaction: unknown): Promise<any> {
  const body = JSON.stringify(interaction);
  const timestamp = "1700000000";
  const signature = hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body)));
  const res = await worker.fetch(
    new Request("https://worker.test/interactions", { method: "POST", headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp }, body }) as any,
    testEnv,
    ctx,
  );
  return res.json();
}

const where = { guild_id: "g1", channel_id: "c1", member: { user: { id: "admin" } } };
const sticky = (sub: string) => ({ type: 2, ...where, data: { name: "sticky", options: [{ name: sub, type: 1 }] } });
const submit = (value: string) => ({
  type: 5,
  ...where,
  data: { custom_id: "sticky:set", components: [{ type: 18, id: 1, component: { type: 4, id: 2, custom_id: "content", value } }] },
});

const addSticky = (channel: string, message: string | null, paused = 0, guild = "g1") =>
  env.DB.prepare("INSERT INTO stickies VALUES (?, ?, ?, ?, ?, 'admin', 0)").bind(channel, guild, `Rules for ${channel}`, message, paused).run();
const getSticky = (channel: string) => env.DB.prepare("SELECT * FROM stickies WHERE channel_id = ?").bind(channel).first<any>();
const posted = (id: string) => () => json({ id });
const gone = () => new Response(null, { status: 204 });

it("/sticky set opens a form, filled in with the current sticky when there is one", async () => {
  const fresh = await send(sticky("set"));
  expect(fresh.type).toBe(9);
  expect(fresh.data.custom_id).toBe("sticky:set");
  expect(fresh.data.components[0].component).not.toHaveProperty("value");

  await addSticky("c1", "m1");
  expect((await send(sticky("set"))).data.components[0].component.value).toBe("Rules for c1");
});

it("submitting the form posts the sticky without pings and replaces the old copy", async () => {
  await addSticky("c1", "m1");
  const calls = mockFetch({ [`POST ${API}/channels/c1/messages`]: posted("m2"), [`DELETE ${API}/channels/c1/messages/m1`]: gone });

  const { data } = await send(submit("  Read the **rules**\n@everyone  "));
  expect(data.flags).toBe(64);
  expect(data.content).toContain("Updated this channel's sticky message");
  expect(JSON.parse(calls[0]!.body)).toEqual({ content: "Read the **rules**\n@everyone", allowed_mentions: { parse: [] } });
  expect(calls[0]!.auth).toBe("Bot bot-token");
  expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
  expect(await getSticky("c1")).toMatchObject({ content: "Read the **rules**\n@everyone", message_id: "m2", set_by: "admin", paused: 0 });
});

it("says what's missing when the bot can't post in the channel, and saves nothing", async () => {
  mockFetch({ [`POST ${API}/channels/c1/messages`]: () => json({ message: "Missing Permissions" }, 403) });
  const { data } = await send(submit("Hello"));
  expect(data.content).toContain("Send Messages");
  expect(await getSticky("c1")).toBeNull();
});

it("allows at most 10 stickies per server", async () => {
  for (let i = 0; i < 10; i++) await addSticky(`other${i}`, null);
  mockFetch({});
  expect((await send(submit("Hello"))).data.content).toContain("already has 10 sticky messages");
});

it("/sticky remove, pause, resume and list", async () => {
  expect((await send(sticky("remove"))).data.content).toContain("has no sticky message");
  await addSticky("c1", "m1");
  await addSticky("c9", null, 0, "another-server");
  const calls = mockFetch({ [`DELETE ${API}/channels/c1/messages/`]: gone, [`POST ${API}/channels/c1/messages`]: posted("m2") });

  expect((await send(sticky("pause"))).data.content).toContain("Paused");
  expect((await getSticky("c1")).paused).toBe(1);
  expect((await send(sticky("list"))).data.content).toBe("**Sticky messages** (1 of 10)\n- <#c1> (paused): Rules for c1");

  expect((await send(sticky("resume"))).data.content).toContain("Resumed");
  expect(await getSticky("c1")).toMatchObject({ paused: 0, message_id: "m2" });

  expect((await send(sticky("remove"))).data.content).toContain("Removed");
  expect(await getSticky("c1")).toBeNull();
  expect(calls.map((c) => `${c.method} ${c.url.slice(API.length)}`)).toEqual([
    "POST /channels/c1/messages",
    "DELETE /channels/c1/messages/m1",
    "DELETE /channels/c1/messages/m2",
  ]);
});

it("the cron moves a sticky down only when something was posted below it", async () => {
  await addSticky("quiet", "q1");
  await addSticky("busy", "b1");
  await addSticky("paused", "p1", 1);
  await addSticky("thread", "t1");
  await addSticky("deleted", "d1");
  const calls = mockFetch({
    [`GET ${API}/guilds/g1/channels`]: () =>
      json([
        { id: "quiet", last_message_id: "q1" },
        { id: "busy", last_message_id: "someone-else" },
        { id: "paused", last_message_id: "someone-else" },
      ]),
    [`GET ${API}/channels/thread`]: () => json({ id: "thread", last_message_id: "reply" }),
    [`GET ${API}/channels/deleted`]: () => json({ message: "Unknown Channel" }, 404),
    [`POST ${API}/channels/busy/messages`]: posted("b2"),
    [`DELETE ${API}/channels/busy/messages/b1`]: gone,
    [`POST ${API}/channels/thread/messages`]: posted("t2"),
    [`DELETE ${API}/channels/thread/messages/t1`]: gone,
  });

  await refreshStickies(await makeCtx(env, 44));

  expect((await getSticky("quiet")).message_id).toBe("q1");
  expect((await getSticky("busy")).message_id).toBe("b2");
  expect((await getSticky("paused")).message_id).toBe("p1");
  expect((await getSticky("thread")).message_id).toBe("t2");
  expect(await getSticky("deleted")).toBeNull();
  expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual([`${API}/channels/busy/messages`, `${API}/channels/thread/messages`]);
});

it("the cron keeps a sticky it can't post, and tries the other servers", async () => {
  await addSticky("locked", "l1", 0, "g1");
  await addSticky("c2", "x1", 0, "g2");
  mockFetch({
    [`GET ${API}/guilds/g1/channels`]: () => json([{ id: "locked", last_message_id: "new" }]),
    [`GET ${API}/guilds/g2/channels`]: () => json([{ id: "c2", last_message_id: "new" }]),
    [`POST ${API}/channels/locked/messages`]: () => json({ message: "Missing Permissions" }, 403),
    [`POST ${API}/channels/c2/messages`]: posted("x2"),
    [`DELETE ${API}/channels/c2/messages/x1`]: gone,
  });

  await refreshStickies(await makeCtx(env, 44));

  expect((await getSticky("locked")).message_id).toBe("l1");
  expect((await getSticky("c2")).message_id).toBe("x2");
});
