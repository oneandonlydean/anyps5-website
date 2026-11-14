import { expect, it } from "vitest";
import { COMMANDS, HELP_SECTIONS } from "../scripts/commands.mjs";
import { helpFields } from "../src/bot/help";
import { interact } from "./helpers";

const ADMIN = "8";
const MODERATE = String(1n << 40n);

it("puts every registered command in exactly one /help section", () => {
  const listed = HELP_SECTIONS.flatMap(([, names]) => names as string[]);
  expect([...listed].sort()).toEqual(COMMANDS.map((c) => c.name).sort());
  expect(new Set(listed).size).toBe(listed.length);
});

it("shows members only the commands they can use", async () => {
  const { data } = await interact({ type: 2, guild_id: "g1", channel_id: "c1", member: { user: { id: "u1" }, roles: [], permissions: "0" }, data: { name: "help" } });
  expect(data.flags).toBe(64);
  const fields = data.embeds[0].fields as { name: string; value: string }[];
  expect(fields.map((f) => f.name)).toEqual(["Games", "Progress and news", "People", "Help and the server"]);
  expect(fields[0]!.value).toContain("`/game <name>` A game's stage on the compatibility list");
  expect(fields.map((f) => f.value).join("\n")).not.toContain("/ban");
});

it("adds moderation for moderators, and everything for admins, within Discord's embed limits", () => {
  const mod = helpFields(MODERATE);
  expect(mod.map((f) => f.name)).toContain("Moderation");
  const modLines = mod.find((f) => f.name === "Moderation")!.value;
  expect(modLines).toContain("/timeout <user> <duration> [reason]");
  expect(modLines).not.toContain("/ban");

  const admin = helpFields(ADMIN);
  expect(admin.map((f) => f.name)).toEqual(HELP_SECTIONS.map(([title]) => title));
  expect(admin.find((f) => f.name === "Server setup")!.value).toContain("/sticky set|remove|pause|resume|list");
  const lines = admin.flatMap((f) => f.value.split("\n"));
  expect(lines).toHaveLength(COMMANDS.length);
  for (const f of admin) expect(f.value.length).toBeLessThanOrEqual(1024);
  expect(admin.reduce((n, f) => n + f.name.length + f.value.length, 0)).toBeLessThanOrEqual(6000 - 100);
});
