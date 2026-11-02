// Registers the slash commands. Re-run after changing them.
// Usage: DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/register-commands.mjs
const { DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_CLIENT_ID || !DISCORD_BOT_TOKEN) {
  console.error("Set DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN");
  process.exit(1);
}

const guildOnly = { integration_types: [0], contexts: [0] };
/** A text option whose suggestions the Worker fills in as people type. */
const text = (name, description, required) => ({ type: 3, name, description, required, autocomplete: true });
const res = await fetch(`https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify([
    {
      name: "prs",
      description: "Show how many merged pull requests a member has",
      options: [{ type: 6, name: "user", description: "Member to look up (defaults to you)", required: false }],
      ...guildOnly,
    },
    {
      name: "leaderboard",
      description: "Top contributors by merged pull requests",
      options: [
        {
          type: 3,
          name: "period",
          description: "Time span to rank (defaults to all time)",
          required: false,
          choices: [
            { name: "All time", value: "all" },
            { name: "Last 30 days", value: "month" },
            { name: "Last 7 days", value: "week" },
          ],
        },
      ],
      ...guildOnly,
    },
    // Answered from the site's data (src/pages/bot/data.json.ts, worker/src/bot/commands.ts).
    { name: "game", description: "A game's stage on the compatibility list", options: [text("name", "Game name or title ID", true)], ...guildOnly },
    { name: "progress", description: "System library, shader recompiler and game progress", ...guildOnly },
    { name: "library", description: "One system library's progress, and what games wait on in it", options: [text("name", "Library, like libkernel or Pad", true)], ...guildOnly },
    { name: "wanted", description: "The missing functions most games are waiting on", ...guildOnly },
    { name: "release", description: "The latest AnyPS5 release and its downloads", ...guildOnly },
    { name: "tracked", description: "How the tracked games do on the latest release", ...guildOnly },
    { name: "report", description: "How to report how far a game gets", options: [text("game", "The game you ran", false)], ...guildOnly },
    { name: "faq", description: "Answers to common questions", options: [text("topic", "What it's about", true)], ...guildOnly },
    { name: "rules", description: "The server rules", ...guildOnly },
    { name: "follow", description: "Get a direct message when a game reaches a new stage", options: [text("game", "Game to follow", true)], ...guildOnly },
    { name: "unfollow", description: "Stop following a game", options: [text("game", "Game to stop following", true)], ...guildOnly },
    { name: "following", description: "The games you follow", ...guildOnly },
  ]),
});
const body = await res.json();
console.log(res.status, res.ok ? body.map((c) => `/${c.name}`).join(" ") : JSON.stringify(body));
process.exit(res.ok ? 0 : 1);
