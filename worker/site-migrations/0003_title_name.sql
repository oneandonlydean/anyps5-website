-- A report without a title ID can name a game that isn't on the compatibility list yet: the uploader gives its title
-- ID and name, and the upload waits for a maintainer.
ALTER TABLE uploads ADD COLUMN title_name TEXT;
