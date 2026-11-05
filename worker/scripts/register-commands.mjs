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
/** An optional text option with fixed choices, given as [label, value]. */
const choice = (name, description, choices) => ({ type: 3, name, description, required: false, choices: choices.map(([label, value]) => ({ name: label, value })) });
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
      description: "Top contributors or testers, all time, this month or this week",
      options: [
        choice("board", "Who to rank (defaults to contributors)", [
          ["Contributors: merged pull requests", "contributors"],
          ["Testers: game reports", "testers"],
        ]),
        choice("period", "Time span to rank by (defaults to all time)", [
          ["All time", "all"],
          ["Last 30 days", "month"],
          ["Last 7 days", "week"],
        ]),
      ],
      ...guildOnly,
    },
    { name: "stats", description: "AnyPS5 in numbers: merges, contributors, libraries, games and testing", ...guildOnly },
    // Answered from the site's data (src/pages/bot/data.json.ts, worker/src/bot/commands.ts).
    { name: "game", description: "A game's stage on the compatibility list", options: [text("name", "Game name or title ID", true)], ...guildOnly },
    {
      name: "progress",
      description: "System library, shader recompiler and game progress",
      options: [
        choice("area", "One area in depth (defaults to everything at a glance)", [
          ["Everything at a glance", "overview"],
          ["System libraries", "libraries"],
          ["Shader recompiler", "shaders"],
          ["Games", "games"],
        ]),
      ],
      ...guildOnly,
    },
    { name: "progressmap", description: "The progress map: every library function, shader forms and what is still needed", ...guildOnly },
    { name: "library", description: "One system library's progress, and what games wait on in it", options: [text("name", "Library, like libkernel or Pad", true)], ...guildOnly },
    { name: "wanted", description: "The missing functions most games are waiting on", ...guildOnly },
    { name: "release", description: "The latest AnyPS5 release and its downloads", ...guildOnly },
    { name: "tracked", description: "How the tracked games do on the latest release", ...guildOnly },
    { name: "report", description: "How to report how far a game gets", options: [text("game", "The game you ran", false)], ...guildOnly },
    { name: "faq", description: "Answers to common questions", options: [text("topic", "What it's about", true)], ...guildOnly },
    { name: "rules", description: "The server rules", ...guildOnly },
    {
      name: "rule",
      description: "One server rule, to point someone at it",
      options: [{ type: 4, name: "number", description: "The rule's number", required: true, min_value: 1, autocomplete: true }],
      ...guildOnly,
    },
    { name: "follow", description: "Get a direct message when a game reaches a new stage", options: [text("game", "Game to follow", true)], ...guildOnly },
    { name: "unfollow", description: "Stop following a game", options: [text("game", "Game to stop following", true)], ...guildOnly },
    { name: "following", description: "The games you follow", ...guildOnly },
    // community.ts
    {
      name: "recent",
      description: "What changed lately: games that moved, releases and progress",
      options: [
        choice("period", "How far back (defaults to the last 7 days)", [
          ["Last 24 hours", "day"],
          ["Last 7 days", "week"],
          ["Last 30 days", "month"],
        ]),
        choice("area", "Only one kind of news (defaults to everything)", [
          ["Everything", "all"],
          ["Games", "games"],
          ["Releases", "releases"],
          ["Progress", "progress"],
        ]),
      ],
      ...guildOnly,
    },
    {
      name: "error",
      description: "What an error message or a missing function means, and whether it's fixed on main",
      options: [{ type: 3, name: "text", description: "The error line the game printed, or a function like sceHttp2SendRequest", required: true, max_length: 500 }],
      ...guildOnly,
    },
    {
      name: "setup",
      description: "The setup guide in short, one step at a time",
      options: [
        choice("step", "One step in more detail (defaults to all of them)", [
          ["1. Check your PC", "requirements"],
          ["2. Prepare your dump", "dump"],
          ["3. Convert the game", "convert"],
          ["4. Run and play", "run"],
          ["5. Fix common problems", "troubleshooting"],
          ["6. Share your results", "report"],
        ]),
      ],
      ...guildOnly,
    },
    {
      name: "games",
      description: "Games that reach a stage, on any system or on yours",
      options: [
        {
          ...choice("stage", "This stage or further", [
            ["Playable", "Playable"],
            ["Ingame", "Ingame"],
            ["Menus", "Menus"],
            ["Presents", "Presents"],
            ["First draw", "First draw"],
            ["Starts", "Starts"],
            ["Loads", "Loads"],
            ["Converts", "Converts"],
          ]),
          required: true,
        },
        choice("gpu", "Only reports on this GPU", [
          ["AMD", "AMD"],
          ["NVIDIA", "NVIDIA"],
          ["Intel", "Intel"],
        ]),
        choice("os", "Only reports on this system", [
          ["Linux", "linux"],
          ["Windows", "windows"],
        ]),
      ],
      ...guildOnly,
    },
    { name: "screenshot", description: "A community screenshot, from any game or one you pick", options: [text("game", "Only this game", false)], ...guildOnly },
    {
      name: "profile",
      description: "Someone's merged pull requests and test reports, and where they rank",
      options: [
        { type: 6, name: "user", description: "Member to look up (defaults to you)", required: false },
        { type: 3, name: "github", description: "Or a GitHub login, for anyone", required: false, max_length: 39 },
      ],
      ...guildOnly,
    },
  ]),
});
const body = await res.json();
console.log(res.status, res.ok ? body.map((c) => `/${c.name}`).join(" ") : JSON.stringify(body));
process.exit(res.ok ? 0 : 1);
