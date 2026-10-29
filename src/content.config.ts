import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const guide = defineCollection({
  // English steps sit at the top level; translations in a folder per language (es/run.mdx).
  loader: glob({ pattern: "**/*.mdx", base: "src/content/guide" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    step: z.number().int().positive(),
  }),
});

export const collections = { guide };
