-- How far the uploader says the game got, past what a run report can record (Menus, Ingame, Playable).
ALTER TABLE uploads ADD COLUMN stated_stage TEXT;
