-- Community votes to ban (for 2 weeks) or silence (for 24 hours) a member, for when no moderator is around.
-- See worker/src/bot/votes.ts.
CREATE TABLE votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT,
  target_id   TEXT NOT NULL,
  target_name TEXT NOT NULL,
  action      TEXT NOT NULL,                -- ban or timeout
  reason      TEXT NOT NULL,
  starter_id  TEXT NOT NULL,
  needed      INTEGER NOT NULL,             -- yes votes needed, as set when the vote started
  created_at  INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open', -- open, passed, failed or cancelled
  result      TEXT,                         -- the closing line the vote message shows
  case_number INTEGER,
  lift_at     INTEGER                       -- a passed ban: when the bot lifts it; cleared once lifted
);
CREATE INDEX votes_open ON votes(status, ends_at);
CREATE INDEX votes_guild ON votes(guild_id, target_id);
CREATE INDEX votes_lift ON votes(lift_at) WHERE lift_at IS NOT NULL;

CREATE TABLE vote_ballots (
  vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  yes     INTEGER NOT NULL, -- 1 for, 0 against
  PRIMARY KEY (vote_id, user_id)
);
