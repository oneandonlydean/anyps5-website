-- A run that presented frames comes with its frame-time file (APS5_TRACE_BENCH). The site keeps the figures it
-- measured from it, never the frame times; the file's digest stops the same file being attached to another report.
ALTER TABLE uploads ADD COLUMN bench TEXT;
ALTER TABLE uploads ADD COLUMN bench_digest TEXT;
CREATE UNIQUE INDEX uploads_bench ON uploads(bench_digest) WHERE bench_digest IS NOT NULL;
