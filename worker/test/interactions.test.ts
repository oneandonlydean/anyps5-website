import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import worker from "../src/index";
import { addUser, ctx } from "./helpers";

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

let keys: CryptoKeyPair;
let testEnv: typeof env;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  testEnv = { ...env, DISCORD_PUBLIC_KEY: hex((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer) };
});

async function send(interaction: unknown, tamper = false): Promise<Response> {
  const body = JSON.stringify(interaction);
  const timestamp = "1700000000";
  const signature = hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body)));
  return worker.fetch(
    new Request("https://worker.test/interactions", {
      method: "POST",
      headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
      body: tamper ? body + " " : body,
    }) as any,
    testEnv,
    ctx,
  );
}

const command = (name: string, caller: string, user?: string) => ({
  type: 2,
  data: { name, options: user ? [{ name: "user", type: 6, value: user }] : [] },
  member: { user: { id: caller } },
});

it("answers a signed ping and rejects unsigned or tampered requests", async () => {
  expect(await (await send({ type: 1 })).json()).toEqual({ type: 1 });
  expect((await send({ type: 1 }, true)).status).toBe(401);
  const unsigned = await worker.fetch(new Request("https://worker.test/interactions", { method: "POST", body: "{}" }) as any, testEnv, ctx);
  expect(unsigned.status).toBe(401);
});

it("/prs shows the caller's count privately", async () => {
  await addUser({ discord_id: "d1", github_login: "alice", merged_prs: 7 });
  const { type, data } = await (await send(command("prs", "d1"))).json<any>();
  expect(type).toBe(4);
  expect(data.flags).toBe(64);
  expect(data.allowed_mentions).toEqual({ parse: [] });
  expect(data.content).toContain("<@d1> has **7** merged pull requests");
  expect(data.content).toContain("[alice](<https://github.com/alice>)");
});

it("/prs handles another member, and unlinked members", async () => {
  await addUser({ discord_id: "d1", github_login: "alice", merged_prs: 1 });
  expect((await (await send(command("prs", "d2", "d1"))).json<any>()).data.content).toContain("<@d1> has **1** merged pull request ");
  expect((await (await send(command("prs", "d2"))).json<any>()).data.content).toContain("You haven't linked");
  expect((await (await send(command("prs", "d1", "d2"))).json<any>()).data.content).toBe("<@d2> hasn't linked a GitHub account.");
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 19) + "Z";
const addMerge = (number: number, authorId: number | null, login: string, mergedAt: string) =>
  env.DB.prepare("INSERT INTO merges VALUES (?, ?, ?, ?, ?)").bind(number, `PR ${number}`, authorId, login, mergedAt).run();

it("/prs lists the member's most recent merges, newest first", async () => {
  await addUser({ discord_id: "d1", github_id: 1, github_login: "alice", merged_prs: 7 });
  for (let i = 1; i <= 7; i++) await addMerge(i, 1, "alice", daysAgo(10 - i));
  await addMerge(99, 2, "bob", daysAgo(0));
  const { data } = await (await send(command("prs", "d1"))).json<any>();
  const lines = data.content.split("\n").filter((l: string) => l.startsWith("- "));
  expect(lines).toHaveLength(5);
  expect(lines[0]).toContain("[#7](<https://github.com/acme/widgets/pull/7>) PR 7");
  expect(lines[4]).toContain("[#3]");
});

it("/leaderboard ranks everyone in the history, linked or not, without bots or pings", async () => {
  await addUser({ discord_id: "d1", github_id: 1, github_login: "alice" });
  await addMerge(1, 1, "alice-old", daysAgo(400));
  await addMerge(2, 1, "alice", daysAgo(3));
  for (let i = 10; i < 13; i++) await addMerge(i, 2, "bob", daysAgo(20));
  for (let i = 20; i < 30; i++) await addMerge(i, 9, "dependabot[bot]", daysAgo(1));
  await addMerge(40, null, "ghost", daysAgo(1));

  const all = (await (await send(command("leaderboard", "d1"))).json<any>()).data;
  expect(all.flags).toBeUndefined();
  expect(all.allowed_mentions).toEqual({ parse: [] });
  expect(all.embeds[0].title).toBe("Top contributors · All time");
  // Bots are left out of the totals and the ranking; a deleted account counts in the merges but not as a contributor.
  expect(all.embeds[0].description).toBe(
    "**6** merged · **5** in 30 days · **2** in 7 days · 2 contributors, 2 active this month\n\n" +
      "🥇 **[bob](<https://github.com/bob>)**\n**3** merged · 3 this month · 0 this week\n" +
      "🥈 **[alice](<https://github.com/alice>)** <@d1>\n**2** merged · 1 this month · 1 this week",
  );

  const period = (value: string) => ({ type: 2, data: { name: "leaderboard", options: [{ name: "period", value }] }, member: { user: { id: "d1" } } });
  const week = (await (await send(period("week"))).json<any>()).data.embeds[0];
  expect(week.title).toBe("Top contributors · Last 7 days");
  expect(week.description.split("\n\n")[1]).toBe("🥇 **[alice](<https://github.com/alice>)** <@d1>\n**1** this week · 2 merged · 1 this month");
  const month = (await (await send(period("month"))).json<any>()).data.embeds[0];
  expect(month.description.split("\n\n")[1].split("\n")).toHaveLength(4);
});

it("/leaderboard copes with an empty history", async () => {
  const { data } = await (await send(command("leaderboard", "d1"))).json<any>();
  expect(data.content).toBe("No merged pull requests yet.");
});
