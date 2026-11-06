-- A maintainer who checked an upload themselves can verify it: it then counts toward the game's stage on its own,
-- without waiting for a second tester.
ALTER TABLE uploads ADD COLUMN verified_by TEXT;
ALTER TABLE uploads ADD COLUMN verified_at INTEGER;
