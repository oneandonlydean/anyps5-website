// Registers the slash commands. Re-run after changing them.
// Usage: DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/register-commands.mjs
import { COMMANDS } from "./commands.mjs";

const { DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_CLIENT_ID || !DISCORD_BOT_TOKEN) {
  console.error("Set DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN");
  process.exit(1);
}


const res = await fetch(`https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify(COMMANDS),
});
const body = await res.json();
console.log(res.status, res.ok ? body.map((c) => `/${c.name}`).join(" ") : JSON.stringify(body));
process.exit(res.ok ? 0 : 1);
