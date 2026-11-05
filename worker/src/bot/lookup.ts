import { matcher, type ErrorSite, type FunctionIndex, type FunctionNeed, type Matcher } from "../../../src/lib/needs";
import { baseUrl, type Env } from "./env";

/**
 * /error's lookup file (src/pages/bot/lookup.json.ts): every system library function and whether today's source
 * implements it, every error message the source raises, and which games' newest reports name each. It is large, so
 * only /error reads it, and each Worker instance keeps it a while.
 */

interface LookupFile {
  commit: string;
  libraries: string[];
  functions: [string, number, 0 | 1][];
  sites: ErrorSite[];
  named: { functions: Record<string, string[]>; errors: Record<string, string[]> };
}

export interface Lookup {
  commit: string;
  functions: FunctionIndex;
  sites: ErrorSite[];
  named: LookupFile["named"];
  match: Matcher["match"];
}

const FRESH_MS = 15 * 60_000;
let cached: { at: number; lookup: Lookup } | undefined;

export async function lookup(env: Env): Promise<Lookup | null> {
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.lookup;
  if (!env.ASSETS) return null;
  try {
    const res = await env.ASSETS.fetch(`${baseUrl(env)}/bot/lookup.json`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const file = await res.json<LookupFile>();
    const functions: FunctionIndex = Object.fromEntries(file.functions.map(([name, library, done]) => [name, [file.libraries[library]!, done]]));
    const { match } = matcher(functions, file.sites);
    cached = { at: Date.now(), lookup: { commit: file.commit, functions, sites: file.sites, named: file.named, match } };
    return cached.lookup;
  } catch {
    return cached?.lookup ?? null;
  }
}

/** For tests: forget the cached file. */
export const forgetLookup = () => {
  cached = undefined;
};

const MAX_FUNCTIONS = 5;
const MAX_ERRORS = 3;

/** One error message, each place the source raises it. */
export interface ErrorMatch {
  message: string;
  sites: { file: string; line: number }[];
}

/**
 * What a pasted line or a typed phrase names. A log line goes through the same matcher the site reads bring-up reports
 * with; when that finds nothing, a single word is taken as part of a function name and a phrase as words of an error
 * message.
 */
export function search(l: Lookup, text: string): { functions: FunctionNeed[]; errors: ErrorMatch[] } {
  const found = l.match(text);
  let functions = found.functions;
  let errors: ErrorMatch[] = found.errors;
  const query = text.trim().toLowerCase();
  if (!functions.length && /^[a-z_][a-z0-9_]{5,}$/i.test(text.trim())) {
    functions = Object.entries(l.functions)
      .filter(([name]) => name.toLowerCase().includes(query))
      .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
      .map(([name, [library, done]]) => ({ name, library, status: done ? ("implemented" as const) : ("missing" as const) }));
  }
  if (!errors.length) {
    const words = query.split(/[^a-z0-9_]+/).filter((w) => w.length >= 3);
    if (words.length) {
      const grouped = new Map<string, ErrorMatch>();
      for (const site of l.sites) {
        const message = site.message.toLowerCase();
        if (!words.every((w) => message.includes(w))) continue;
        const entry = grouped.get(site.message) ?? { message: site.message, sites: [] };
        entry.sites.push({ file: site.file, line: site.line });
        grouped.set(site.message, entry);
      }
      // The closest wording first: the shortest message that has every word.
      errors = [...grouped.values()].sort((a, b) => a.message.length - b.message.length);
    }
  }
  return { functions: functions.slice(0, MAX_FUNCTIONS), errors: errors.slice(0, MAX_ERRORS) };
}
