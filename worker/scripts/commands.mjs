// The bot's slash commands, as registered with Discord. register-commands.mjs sends them; the maintainers' page
// (src/pages/moderate/bot.astro) lists them, so it never falls behind.

const guildOnly = { integration_types: [0], contexts: [0] };
/** A text option whose suggestions the Worker fills in as people type. */
const text = (name, description, required) => ({ type: 3, name, description, required, autocomplete: true });
/** An optional text option with fixed choices, given as [label, value]. */
const choice = (name, description, choices) => ({ type: 3, name, description, required: false, choices: choices.map(([label, value]) => ({ name: label, value })) });
/** A subcommand without options. */
const sub = (name, description) => ({ type: 1, name, description });
/**
 * Who sees a command by default, as a permission they need. A server admin can let other roles use any of them in
 * Server Settings → Integrations → the bot.
 */
const allowed = (permission) => ({ default_member_permissions: permission });
const adminOnly = allowed("8");
const PERM = { kick: "2", ban: "4", channels: "16", messages: "8192", moderate: "1099511627776" };
/** Option types. */
const T = { sub: 1, group: 2, string: 3, int: 4, user: 6, channel: 7, role: 8 };
const TEXT_CHANNELS = [0, 5];
const opt = (type, name, description, required = false, extra = {}) => ({ type, name, description, required, ...extra });
const group = (name, description, options) => ({ type: T.group, name, description, options });
const subWith = (name, description, options) => ({ type: T.sub, name, description, options });
const member = (description = "The member") => opt(T.user, "user", description, true);
const reason = opt(T.string, "reason", "Why; they're told, and it goes in the case", false, { max_length: 400 });
/**
 * How /help groups the commands, in the order it lists them; the same groups as the maintainers' page. Every command
 * is in exactly one (test/help.test.ts checks).
 */
export const HELP_SECTIONS = [
  ["Games", ["game", "games", "screenshot", "report", "follow", "unfollow", "following"]],
  ["Progress and news", ["progress", "progressmap", "library", "wanted", "release", "tracked", "recent", "stats"]],
  ["People", ["leaderboard", "profile", "prs"]],
  ["Help and the server", ["help", "setup", "error", "faq", "rules", "rule", "tag", "votekick"]],
  ["Moderation", ["ban", "unban", "kick", "timeout", "untimeout", "warn", "warnings", "unwarn", "purge", "slowmode", "lock", "unlock"]],
  ["Server setup", ["roles", "tags", "logs", "welcome", "autorole", "automod", "sticky", "votekicks"]],
];
export const COMMANDS = [
  { name: "help", description: "Every bot command you can use", ...guildOnly },
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
  // sticky.ts
  {
    name: "sticky",
    description: "Keep a message at the bottom of this channel",
    options: [
      sub("set", "Add or change this channel's sticky message"),
      sub("remove", "Remove this channel's sticky message"),
      sub("pause", "Stop moving this channel's sticky message down, without removing it"),
      sub("resume", "Move this channel's paused sticky message down again"),
      sub("list", "Every sticky message in this server"),
    ],
    ...adminOnly,
    ...guildOnly,
  },
  // Community votes (votes.ts).
  {
    name: "votekick",
    description: "Start a vote to ban or silence someone, for when no moderator is around",
    options: [
      opt(T.user, "user", "Who the vote is about", true),
      opt(T.string, "action", "What happens if it passes", true, {
        choices: [
          { name: "Silence for 24 hours", value: "timeout" },
          { name: "Ban for 2 weeks", value: "ban" },
        ],
      }),
      opt(T.string, "reason", "Why; everyone voting sees it", true, { max_length: 200 }),
    ],
    ...guildOnly,
  },
  {
    name: "votekicks",
    description: "Community votes to ban or silence members",
    options: [
      subWith("on", "Turn votes on, or change how they work", [
        opt(T.role, "mod_role", "Pinged when a vote starts; its members can cancel votes", true),
        opt(T.int, "votes", "Yes votes needed (defaults to 5)", false, { min_value: 2, max_value: 25 }),
        opt(T.role, "voter_role", "Only members with this role can vote (defaults to anyone here 2 weeks)"),
      ]),
      sub("off", "Turn votes off"),
      subWith("channel", "Allow votes in a channel, or stop allowing them (no channels: anywhere)", [
        opt(T.channel, "channel", "The channel", true, { channel_types: TEXT_CHANNELS }),
      ]),
      sub("show", "How votes are set up"),
    ],
    ...adminOnly,
    ...guildOnly,
  },
  // Moderation (moderation.ts). Each is for members with the matching permission.
  {
    name: "ban",
    description: "Ban a member, or anyone by ID",
    options: [
      member("Who to ban"),
      reason,
      opt(T.int, "delete_messages", "Also delete their recent messages", false, {
        choices: [
          { name: "None", value: 0 },
          { name: "Last hour", value: 3600 },
          { name: "Last day", value: 86400 },
          { name: "Last 7 days", value: 604800 },
        ],
      }),
    ],
    ...allowed(PERM.ban),
    ...guildOnly,
  },
  { name: "unban", description: "Lift a ban", options: [opt(T.user, "user", "Who to unban; paste their ID", true), reason], ...allowed(PERM.ban), ...guildOnly },
  { name: "kick", description: "Kick a member", options: [member("Who to kick"), reason], ...allowed(PERM.kick), ...guildOnly },
  {
    name: "timeout",
    description: "Stop a member from talking for a while",
    options: [member("Who to time out"), opt(T.string, "duration", "Like 10m, 1h, 2d or 1w; 28 days at most", true, { max_length: 20 }), reason],
    ...allowed(PERM.moderate),
    ...guildOnly,
  },
  { name: "untimeout", description: "End a member's timeout early", options: [member(), reason], ...allowed(PERM.moderate), ...guildOnly },
  {
    name: "warn",
    description: "Warn a member; it's kept as a case",
    options: [member("Who to warn"), { ...reason, required: true, description: "What for; they're told" }],
    ...allowed(PERM.moderate),
    ...guildOnly,
  },
  { name: "warnings", description: "A member's warnings and other cases", options: [member()], ...allowed(PERM.moderate), ...guildOnly },
  { name: "unwarn", description: "Take back a warning or timeout, so it no longer counts", options: [opt(T.int, "case", "The case number, from /warnings", true, { min_value: 1 })], ...allowed(PERM.moderate), ...guildOnly },
  {
    name: "purge",
    description: "Delete recent messages in this channel",
    options: [opt(T.int, "count", "How many, up to 100", true, { min_value: 1, max_value: 100 }), opt(T.user, "user", "Only this member's messages")],
    ...allowed(PERM.messages),
    ...guildOnly,
  },
  {
    name: "slowmode",
    description: "How long members wait between messages",
    options: [
      opt(T.int, "seconds", "The wait", true, {
        choices: [
          ["Off", 0],
          ["5 seconds", 5],
          ["10 seconds", 10],
          ["30 seconds", 30],
          ["1 minute", 60],
          ["5 minutes", 300],
          ["15 minutes", 900],
          ["1 hour", 3600],
          ["6 hours", 21600],
        ].map(([name, value]) => ({ name, value })),
      }),
      opt(T.channel, "channel", "Defaults to this channel", false, { channel_types: TEXT_CHANNELS }),
    ],
    ...allowed(PERM.channels),
    ...guildOnly,
  },
  {
    name: "lock",
    description: "Stop members posting in a channel",
    options: [opt(T.channel, "channel", "Defaults to this channel", false, { channel_types: TEXT_CHANNELS }), { ...reason, description: "Shown in the channel" }],
    ...allowed(PERM.channels),
    ...guildOnly,
  },
  {
    name: "unlock",
    description: "Let members post in a locked channel again",
    options: [opt(T.channel, "channel", "Defaults to this channel", false, { channel_types: TEXT_CHANNELS })],
    ...allowed(PERM.channels),
    ...guildOnly,
  },
  // Role panels (roles.ts).
  {
    name: "roles",
    description: "Panels where members pick their own roles",
    options: [
      subWith("create", "Post a new role panel", [
        opt(T.string, "style", "Buttons, or a menu (defaults to buttons)", false, { choices: [{ name: "Buttons", value: "buttons" }, { name: "Menu", value: "menu" }] }),
        opt(T.string, "mode", "How picking works (defaults to toggle)", false, {
          choices: [
            { name: "Toggle: pick to get, pick again to drop", value: "toggle" },
            { name: "Unique: one role at a time", value: "unique" },
            { name: "Add only: roles can't be dropped here", value: "add" },
          ],
        }),
        opt(T.channel, "channel", "Where to post it (defaults to this channel)", false, { channel_types: TEXT_CHANNELS }),
      ]),
      subWith("add", "Add a role to a panel, or change how it shows", [
        opt(T.int, "panel", "The panel", true, { autocomplete: true }),
        opt(T.role, "role", "The role", true),
        opt(T.string, "label", "Button text (defaults to the role's name)", false, { max_length: 80 }),
        opt(T.string, "emoji", "An emoji for it", false, { max_length: 64 }),
        opt(T.string, "description", "A few words about it", false, { max_length: 100 }),
      ]),
      subWith("remove", "Take a role off a panel", [opt(T.int, "panel", "The panel", true, { autocomplete: true }), opt(T.role, "role", "The role", true)]),
      subWith("edit", "Change a panel's title or description", [opt(T.int, "panel", "The panel", true, { autocomplete: true })]),
      subWith("delete", "Delete a panel and its message", [opt(T.int, "panel", "The panel", true, { autocomplete: true })]),
      sub("list", "Every role panel in this server"),
    ],
    ...adminOnly,
    ...guildOnly,
  },
  // Tags (tags.ts).
  { name: "tag", description: "Post a saved reply", options: [opt(T.string, "name", "Which tag", true, { autocomplete: true })], ...guildOnly },
  {
    name: "tags",
    description: "Manage the saved replies /tag posts",
    options: [
      sub("add", "Save a new tag"),
      subWith("edit", "Change a tag's reply", [opt(T.string, "name", "Which tag", true, { autocomplete: true })]),
      subWith("delete", "Delete a tag", [opt(T.string, "name", "Which tag", true, { autocomplete: true })]),
      sub("list", "Every tag"),
    ],
    ...allowed(PERM.messages),
    ...guildOnly,
  },
  // What the gateway does (settings.ts, events.ts).
  {
    name: "logs",
    description: "Where the bot logs what happens in the server",
    options: [
      subWith("set", "Send one kind of log to a channel", [
        opt(T.string, "type", "What to log", true, {
          choices: [
            { name: "Edited and deleted messages", value: "messages" },
            { name: "Joins, leaves, nicknames and roles", value: "members" },
            { name: "Moderation cases and bans", value: "moderation" },
          ],
        }),
        opt(T.channel, "channel", "The log channel", true, { channel_types: TEXT_CHANNELS }),
      ]),
      subWith("off", "Stop one kind of log", [
        opt(T.string, "type", "What to stop logging", true, {
          choices: [
            { name: "Edited and deleted messages", value: "messages" },
            { name: "Joins, leaves, nicknames and roles", value: "members" },
            { name: "Moderation cases and bans", value: "moderation" },
          ],
        }),
      ]),
      sub("show", "Where each log goes"),
    ],
    ...adminOnly,
    ...guildOnly,
  },
  {
    name: "welcome",
    description: "Messages for members joining and leaving",
    options: [
      subWith("join", "Set the welcome message", [opt(T.channel, "channel", "Where to post it", true, { channel_types: TEXT_CHANNELS })]),
      subWith("leave", "Set the goodbye message", [opt(T.channel, "channel", "Where to post it", true, { channel_types: TEXT_CHANNELS })]),
      subWith("off", "Turn one off", [
        opt(T.string, "which", "Which message", true, { choices: [{ name: "Welcome", value: "join" }, { name: "Goodbye", value: "leave" }] }),
      ]),
      sub("show", "Preview both"),
    ],
    ...adminOnly,
    ...guildOnly,
  },
  {
    name: "autorole",
    description: "Roles every new member gets",
    options: [
      subWith("add", "Give new members a role", [opt(T.role, "role", "The role", true)]),
      subWith("remove", "Stop giving new members a role", [opt(T.role, "role", "The role", true)]),
      sub("list", "The roles new members get"),
    ],
    ...adminOnly,
    ...guildOnly,
  },
  {
    name: "automod",
    description: "Catch spam, links, invites and blocked words",
    options: [
      subWith("filter", "Turn a filter on or off, and choose what it does", [
        opt(T.string, "filter", "Which filter", true, {
          choices: [
            { name: "Scams: crypto, fake giveaways, phishing", value: "scam" },
            { name: "Piracy: asking for or sharing games, PKGs, keys", value: "piracy" },
            { name: "Hidden links: shorteners, base64", value: "hidden" },
            { name: "ETA questions (PS5 games, GTA 6)", value: "eta" },
            { name: "Same message in several channels", value: "crosspost" },
            { name: "Invites to other servers", value: "invites" },
            { name: "Links (except allowed sites)", value: "links" },
            { name: "Mass mentions", value: "mentions" },
            { name: "Too many capitals", value: "caps" },
            { name: "Spam: many messages fast", value: "spam" },
            { name: "Repeated messages", value: "duplicates" },
            { name: "Blocked words", value: "words" },
          ],
        }),
        opt(T.string, "action", "What it does", true, {
          choices: [
            { name: "Off", value: "off" },
            { name: "Delete, with a short notice", value: "delete" },
            { name: "Strike: warning, then timeout, then ban", value: "strike" },
            { name: "Delete and answer (ETA only)", value: "answer" },
          ],
        }),
        opt(T.int, "limit", "Mentions, percent capitals, messages in 5 seconds, repeats or channels", false, { min_value: 2, max_value: 100 }),
      ]),
      group("words", "Blocked words", [
        subWith("add", "Block words", [opt(T.string, "words", "Comma-separated", true, { max_length: 1000 })]),
        subWith("remove", "Unblock words", [opt(T.string, "words", "Comma-separated", true, { max_length: 1000 })]),
      ]),
      group("links", "Sites the links filter allows", [
        subWith("allow", "Allow links to sites", [opt(T.string, "domains", "Like github.com, comma-separated", true, { max_length: 1000 })]),
        subWith("disallow", "Stop allowing sites", [opt(T.string, "domains", "Comma-separated", true, { max_length: 1000 })]),
      ]),
      group("ignore", "Channels and roles automod leaves alone", [
        subWith("channel", "Ignore a channel, or check it again", [opt(T.channel, "channel", "The channel", true)]),
        subWith("role", "Ignore a role, or check it again", [opt(T.role, "role", "The role", true)]),
      ]),
      sub("setup", "Turn on the recommended filters"),
      subWith("rules", "The rules channel warnings point to", [opt(T.channel, "channel", "The rules channel", true, { channel_types: TEXT_CHANNELS })]),
      subWith("test", "See what automod would do with a message", [opt(T.string, "message", "The message", true, { max_length: 2000 })]),
      subWith("timeout", "How long the ladder's timeout lasts (defaults to 24 hours)", [opt(T.int, "minutes", "Minutes", true, { min_value: 1, max_value: 40320 })]),
      sub("show", "Every filter and setting"),
    ],
    ...adminOnly,
    ...guildOnly,
  },
];
