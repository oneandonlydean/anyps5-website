-- Sticky messages set with /sticky: the bot keeps each one as the last message in its channel, posting it again below
-- newer messages (worker/src/bot/sticky.ts).
CREATE TABLE stickies (
  channel_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  content    TEXT NOT NULL,
  message_id TEXT,                       -- the posted copy, deleted when it is posted again further down
  paused     INTEGER NOT NULL DEFAULT 0, -- 1: kept, but not moved down until /sticky resume
  set_by     TEXT NOT NULL,              -- Discord id of whoever last set it
  updated_at INTEGER NOT NULL
);
CREATE INDEX stickies_guild ON stickies(guild_id);
