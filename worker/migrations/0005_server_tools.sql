-- The server tools that replace Carl-bot: moderation cases, role panels, tags and per-server settings (logs, welcome,
-- autorole, automod). See worker/src/bot/guild.ts.

-- Each server's settings, one JSON value per key: "logs", "welcome", "autoroles", "automod".
CREATE TABLE guild_settings (
  guild_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, key)
);

-- Moderation cases, numbered per server: warnings, timeouts, kicks and bans, by a moderator or by automod.
CREATE TABLE cases (
  guild_id     TEXT NOT NULL,
  number       INTEGER NOT NULL,
  action       TEXT NOT NULL,              -- warn, timeout, untimeout, kick, ban, unban
  user_id      TEXT NOT NULL,
  moderator_id TEXT NOT NULL,              -- the bot's own id for automod
  reason       TEXT,
  duration     INTEGER,                    -- seconds, for timeouts
  active       INTEGER NOT NULL DEFAULT 1, -- 0: a warning taken back with /unwarn
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, number)
);
CREATE INDEX cases_user ON cases(guild_id, user_id);

-- Self-assign role panels: a message with a button or menu entry per role.
CREATE TABLE role_panels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  style       TEXT NOT NULL DEFAULT 'buttons', -- buttons or menu
  mode        TEXT NOT NULL DEFAULT 'toggle',  -- toggle, unique (one role at a time) or add (can't be taken off)
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX role_panels_guild ON role_panels(guild_id);

CREATE TABLE role_panel_roles (
  panel_id    INTEGER NOT NULL REFERENCES role_panels(id) ON DELETE CASCADE,
  role_id     TEXT NOT NULL,
  label       TEXT NOT NULL,
  emoji       TEXT,
  description TEXT,
  position    INTEGER NOT NULL,
  PRIMARY KEY (panel_id, role_id)
);

-- Saved replies posted with /tag.
CREATE TABLE tags (
  guild_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  uses       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, name)
);
