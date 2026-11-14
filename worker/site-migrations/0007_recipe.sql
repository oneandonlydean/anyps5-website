-- A report can come with its run recipe (anyps5-recipe.json): the arguments, ANYPS5_* variables and config file
-- names the run was started with. The site keeps the recipe as checked, only the fields it knows, to show with the report.
ALTER TABLE uploads ADD COLUMN recipe TEXT;
