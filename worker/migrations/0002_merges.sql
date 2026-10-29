-- Every merged PR on the repo, bots included. Backfilled once by
-- scripts/backfill-merges.mjs and kept current by the merge poll.
CREATE TABLE merges (
  number       INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  author_id    INTEGER,                  -- GitHub user id; null for deleted accounts
  author_login TEXT NOT NULL,            -- login at merge time
  merged_at    TEXT NOT NULL             -- ISO 8601, as GitHub reports it
);
CREATE INDEX merges_author ON merges(author_id, merged_at);
CREATE INDEX merges_merged_at ON merges(merged_at);
