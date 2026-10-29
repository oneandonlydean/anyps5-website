CREATE TABLE users (
  discord_id        TEXT PRIMARY KEY,
  github_id         INTEGER UNIQUE,      -- stable; logins can be renamed
  github_login      TEXT,                -- refreshed from GitHub on each resync
  merged_prs        INTEGER NOT NULL DEFAULT 0,  -- last count pushed to Discord; -1 forces a push
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  token_expires_at  INTEGER NOT NULL,    -- unix seconds
  synced_at         INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);
CREATE INDEX users_synced ON users(synced_at);

CREATE TABLE oauth_state (
  state       TEXT PRIMARY KEY,
  discord_id  TEXT,                      -- null for step 1, set for the GitHub leg
  expires_at  INTEGER NOT NULL
);

CREATE TABLE kv (
  key   TEXT PRIMARY KEY,                -- 'last_merged_at'
  value TEXT NOT NULL
);
