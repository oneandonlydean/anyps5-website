// Registers the slash commands. Re-run after changing them.
// Usage: DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/register-commands.mjs
const { DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_CLIENT_ID || !DISCORD_BOT_TOKEN) {
  console.error("Set DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN");
  process.exit(1);
}

const guildOnly = { integration_types: [0], contexts: [0] };
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
  ]),
});
const body = await res.json();
console.log(res.status, res.ok ? body.map((c) => `/${c.name}`).join(" ") : JSON.stringify(body));
process.exit(res.ok ? 0 : 1);
