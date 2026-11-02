-- Games members follow with /follow: the bot sends them a direct message when one reaches a new stage.
CREATE TABLE follows (
  discord_id TEXT NOT NULL,
  slug       TEXT NOT NULL,              -- the game's slug on the site
  created_at INTEGER NOT NULL,
  PRIMARY KEY (discord_id, slug)
);
CREATE INDEX follows_slug ON follows(slug);
