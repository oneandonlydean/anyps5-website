// One-time registration of the Linked Roles metadata schema.
// Usage: DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/register-metadata.mjs
const { DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_CLIENT_ID || !DISCORD_BOT_TOKEN) {
  console.error("Set DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN");
  process.exit(1);
}

const res = await fetch(
  `https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/role-connections/metadata`,
  {
    method: "PUT",
    headers: { authorization: `Bot ${DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify([
      {
        key: "merged_prs",
        name: "Merged PRs",
        description: "Pull requests merged into the project repo",
        type: 2, // INTEGER_GREATER_THAN_OR_EQUAL
      },
    ]),
  },
);
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
