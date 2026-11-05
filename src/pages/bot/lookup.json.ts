import { getNeeds } from "../../lib/data";
import { loadGenerated } from "../../lib/load";
import type { ErrorSite, FunctionIndex } from "../../lib/needs";

/**
 * What the Discord bot's /error looks things up in: every system library function with whether today's source
 * implements it, every error message the source raises and where, and which games' newest reports name each. Kept out
 * of /bot/data.json, which every command reads, because the function list alone is most of a megabyte.
 */
export async function GET() {
  const [functions, errors, needs] = await Promise.all([
    loadGenerated<FunctionIndex>("progress-functions.json", {}),
    loadGenerated<{ commit: string; sites: ErrorSite[] }>("error-sites.json", { commit: "main", sites: [] }),
    getNeeds(),
  ]);
  // Library names once, functions as [name, library index, implemented].
  const libraries = [...new Set(Object.values(functions).map(([library]) => library))].sort();
  const index = new Map(libraries.map((l, i) => [l, i]));
  const named = { functions: {} as Record<string, string[]>, errors: {} as Record<string, string[]> };
  for (const [slug, n] of needs) {
    for (const f of n.functions) (named.functions[f.name] ??= []).push(slug);
    for (const e of n.errors) (named.errors[e.message] ??= []).push(slug);
  }
  const body = {
    commit: errors.commit,
    libraries,
    functions: Object.entries(functions).map(([name, [library, done]]) => [name, index.get(library)!, done]),
    sites: errors.sites,
    named,
  };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}
