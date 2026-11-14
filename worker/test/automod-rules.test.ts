import { describe, expect, it } from "vitest";
import bot from "../../data/bot.yaml?raw";
import { indexRules, NO_RULES, scan, type Filter, type MessageFacts, type RulesIndex } from "../src/bot/automod-rules";

/** The server rules as data/bot.yaml has them: the text people paste. */
const RULES = bot.slice(bot.indexOf("rules: |-"), bot.indexOf("\nanswers:"));
const rules = indexRules(RULES);

const ALL: Partial<Record<Filter, { limit?: number }>> = { scam: {}, piracy: {}, hidden: {}, eta: {}, invites: {}, mentions: { limit: 6 } };

function caught(content: string, facts: Partial<MessageFacts> = {}, index: RulesIndex = rules) {
  return scan({ content, mentions: 0, everyone: false, newcomer: false, ...facts }, { enabled: ALL, words: [], allowedLinks: [], rules: index });
}
const filter = (content: string, facts: Partial<MessageFacts> = {}) => caught(content, facts)?.filter;

describe("scams", () => {
  it.each([
    "🚀 $ANYPS5 token presale is live! Connect your wallet at https://anyps5-coin.xyz",
    "free airdrop for early holders",
    "a i r d r o p for holders, connect wallet",
    "41rdr0p live, claim now",
    "аirdrop live now",
    "𝐚𝐢𝐫𝐝𝐫𝐨𝐩 live now",
    "air​drop live now",
    "I'm giving away 3 PS5s, first 10 people to DM me",
    "Join our meme coin launch, 100x gem",
    "check pump.fun/coin/xyz",
    "Free GTA 6 for everyone who joins",
    "send me your seed phrase to verify",
  ])("catches %j", (text) => expect(filter(text)).toBe("scam"));

  it.each([
    "free nitro https://dlscord-nitro.com/claim",
    "[steamcommunity.com/gift](https://steamcommunity.gift-claim.ru/abc)",
    "your gift: https://dіscord.com/gifts/abc",
    "@everyone free airdrop https://x.example.com",
  ])("treats %j as severe", (text) => {
    expect(caught(text)).toMatchObject({ filter: "scam", severe: true });
  });

  it.each([
    "I mined bitcoin back in 2013 lol",
    "is this an NFT or a real game?",
    "Epic has a giveaway this week https://store.epicgames.com/free",
    "beware of airdrop scams in DMs",
    "the ico file for the shortcut is broken",
    "here's the gift link from Discord: https://discord.gift/abc123",
    "the profit from the new GPU is worth it",
  ])("leaves %j alone", (text) => expect(caught(text)).toBeUndefined());

  it("is stricter with a brand-new member posting a link", () => {
    expect(filter("giveaway https://example.com/x")).toBeUndefined();
    expect(filter("crypto giveaway https://example.com/x")).toBe("scam");
    expect(filter("crypto https://example.com/x", { newcomer: true })).toBe("scam");
  });
});

describe("piracy", () => {
  it.each([
    "can someone send me the gta 6 pkg",
    "where can i download ps5 games",
    "anyone got a dump link for bloodborne?",
    "f p k g anyone?",
    "gta vi free pc download",
    "dm me the firmware pls",
    "https://mega.nz/file/abc pkg files here",
    "fitgirl repack when",
    "send me your dump",
    "who has the gta 6 iso",
  ])("catches %j", (text) => expect(filter(text)).toBe("piracy"));

  it.each([
    "give the game a try",
    "anyone have a link to the guide?",
    "my pkg files won't convert, the relinker says error",
    "can you share your crash dump logs?",
    "where do I get the system libraries?",
    "how do i dump my own games",
    "I use qbittorrent for linux isos",
    "Epic has free games this week",
    "don't ask for pkg links here, it's against the rules",
    "send me the game report when it crashes",
    "how do i get the game to boot?",
  ])("leaves %j alone", (text) => expect(caught(text)).toBeUndefined());
});

describe("quoting the rules", () => {
  it("never catches the server rules pasted whole", () => {
    expect(caught(RULES)).toBeUndefined();
  });

  it("never catches one rule quoted inside a message", () => {
    const rule1 = RULES.slice(RULES.indexOf("**1."), RULES.indexOf("\n", RULES.indexOf("**1.")));
    expect(caught(`@newbie please read this:\n> ${rule1}\nthanks`)).toBeUndefined();
  });

  it("catches what the rules forbid when it isn't a quote", () => {
    const custom = indexRules("4. Asking where to get games will get you banned.");
    expect(caught("4. Asking where to get games will get you banned.", {}, custom)).toBeUndefined();
    expect(caught("4. Asking where to get games will get you banned.", {}, NO_RULES)?.filter).toBe("piracy");
    expect(caught("where to get games?", {}, custom)?.filter).toBe("piracy");
  });
});

describe("hidden links", () => {
  it.each(["https://bit.ly/3abc", "go to bit[.]ly/abc", "aHR0cHM6Ly9leGFtcGxlLmNvbQ==", "link: aHR0cHM6Ly9ldmlsLmV4YW1wbGUuY29tL3BrZw"])("catches %j", (text) => expect(filter(text)).toBe("hidden"));
  it("leaves other base64 alone", () => expect(caught("token: SGVsbG8gd29ybGQgdGhpcyBpcyBmaW5l")).toBeUndefined());
});

describe("ETA questions", () => {
  it.each(["when will ps5 games be playable?", "does gta 6 work yet?", "gta 6 when?", "how long until anyps5 runs gta vi", "any eta for ps5 games?", "is anyps5 ready yet"])(
    "catches %j",
    (text) => expect(filter(text)).toBe("eta"),
  );
  it.each(["when I bought my PS5 it was ready to go", "how long does the ps5 dump take?", "No ETA or game demands.", "GTA 6 looks amazing in the trailer"])("leaves %j alone", (text) =>
    expect(caught(text)).toBeUndefined(),
  );
});

describe("the rest", () => {
  it("invites and mass mentions", () => {
    expect(filter("join discord.gg/abc123")).toBe("invites");
    expect(caught("hi all", { mentions: 6 })).toMatchObject({ filter: "mentions", severe: true });
  });

  it("custom words match like Discord's, through disguises, even after a negation", () => {
    const words = (content: string) => scan({ content, mentions: 0, everyone: false, newcomer: false }, { enabled: { words: {} }, words: ["*fortnite*", "lag"], allowedLinks: [], rules })?.filter;
    expect(words("FORTNITE")).toBe("words");
    expect(words("f o r t n i t e")).toBe("words");
    expect(words("not fortnite")).toBe("words");
    expect(words("so much lag")).toBe("words");
    expect(words("flagged")).toBeUndefined();
  });
});
