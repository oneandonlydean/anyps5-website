-- Version 1 of the run report format: each report carries its run's id, so the same run is stored once even when
-- the file was re-saved; and a report without a title ID can be attached to a game the uploader chose.
ALTER TABLE uploads ADD COLUMN run_id TEXT;
ALTER TABLE uploads ADD COLUMN title_chosen INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX uploads_run ON uploads(run_id) WHERE run_id IS NOT NULL;
