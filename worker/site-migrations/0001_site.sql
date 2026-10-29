-- The site's own data: people who signed in with GitHub, their uploaded run reports, and what maintainers hid.
-- Separate from the Discord bot's database, so the site can run where the bot does not.

CREATE TABLE accounts (
  github_id   INTEGER PRIMARY KEY,           -- stable; logins can be renamed
  login       TEXT NOT NULL,                 -- refreshed at each sign-in
  avatar      TEXT,
  blocked     INTEGER NOT NULL DEFAULT 0,    -- set by a maintainer; hides the account's uploads
  created_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,              -- SHA-256 of the cookie value; the value itself is never stored
  github_id   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE login_state (
  state       TEXT PRIMARY KEY,
  return_to   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE uploads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id   INTEGER NOT NULL,
  title_id    TEXT NOT NULL,
  stage       TEXT NOT NULL,                 -- the report's run stage
  commit_sha  TEXT NOT NULL,
  report      TEXT NOT NULL,                 -- the validated report, as JSON
  digest      TEXT NOT NULL UNIQUE,          -- SHA-256 of that JSON, so a file is stored once
  flags       TEXT NOT NULL DEFAULT '[]',    -- what the consistency checks found
  status      TEXT NOT NULL DEFAULT 'visible', -- visible | review (flagged, waiting for a maintainer) | hidden
  created_at  INTEGER NOT NULL
);
CREATE INDEX uploads_title ON uploads(title_id, status);
CREATE INDEX uploads_account ON uploads(github_id, created_at);

-- Things maintainers hid: kind 'screenshot' (target: image id) or 'art' (target: '<game key>:<role>').
CREATE TABLE hidden (
  kind        TEXT NOT NULL,
  target      TEXT NOT NULL,
  reason      TEXT,
  by_login    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (kind, target)
);

CREATE TABLE moderation_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  target      TEXT NOT NULL,
  reason      TEXT,
  by_login    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE site_kv (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);
