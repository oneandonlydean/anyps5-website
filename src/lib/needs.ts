/**
 * Reads a bring-up report's blocker text for the work it names: system library functions, and errors the recompiler
 * or graphics driver raise. Matches are checked against current progress data, so a page can say whether each one is
 * still open.
 */

export type FunctionStatus = "implemented" | "missing" | "undeclared";

export interface FunctionNeed {
  name: string;
  /** The library label; for undeclared functions, the declared library whose prefix the name starts with. */
  library: string;
  status: FunctionStatus;
}

export interface ErrorSite {
  file: string;
  line: number;
  message: string;
}

/** One error message, which the source may raise from several places. */
export interface ErrorNeed {
  message: string;
  sites: { file: string; line: number }[];
}

export interface Needs {
  functions: FunctionNeed[];
  errors: ErrorNeed[];
}

/** Function name → [library label, 1 when implemented], as written by fetch-upstream. */
export type FunctionIndex = Record<string, [string, 0 | 1]>;

const SUFFIX = /_nid_(?:no_patch(?:_cut)?|postfix)$/;
const FUNCTION = /\bsce[A-Z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*/g;

export interface Matcher {
  match(text: string): Needs;
}

export function matcher(functions: FunctionIndex, sites: ErrorSite[]): Matcher {
  const index = new Map<string, [string, 0 | 1]>();
  for (const [name, entry] of Object.entries(functions)) index.set(name.replace(SUFFIX, ""), entry);
  const declared = [...index.keys()];
  // Longest labels first, so "AudioOut2" wins over "AudioOut" when guessing an undeclared function's library.
  const labels = [...new Set(Object.values(functions).map(([label]) => label))].sort((a, b) => b.length - a.length);

  // An error matches when every literal part of its message appears in the text, in order. Short or generic parts
  // ("… is not implemented", "ShaderRecompiler::Recompile: …") would match almost anything, so at least one part must
  // read like a phrase: 24 characters and three words.
  const grouped = new Map<string, ErrorNeed>();
  for (const { message, file, line } of sites) {
    const need = grouped.get(message) ?? { message, sites: [] };
    need.sites.push({ file, line });
    grouped.set(message, need);
  }
  const patterns = [...grouped.values()]
    .map((need) => ({ need, parts: need.message.split("…").map((p) => p.trim().toLowerCase()).filter((p) => p.length >= 4) }))
    .filter(({ parts }) => parts.some((p) => p.length >= 24 && p.split(/\s+/).length >= 3));

  return {
    match(text) {
      const seen = new Set<string>();
      const needs: FunctionNeed[] = [];
      for (const [raw] of text.matchAll(FUNCTION)) {
        const name = raw.replace(SUFFIX, "");
        if (seen.has(name)) continue;
        seen.add(name);
        const entry = index.get(name);
        if (entry) {
          needs.push({ name, library: entry[0], status: entry[1] ? "implemented" : "missing" });
          continue;
        }
        // A name that starts a declared function ("scePad", "sceGnmSet…") is a family or a wildcard, not a function.
        const library = labels.find((l) => name.startsWith(`sce${l}`) && name.length > l.length + 3);
        if (library && !declared.some((d) => d.startsWith(name))) needs.push({ name, library, status: "undeclared" });
      }

      const lower = text.toLowerCase();
      const errors = patterns
        .filter(({ parts }) => {
          let from = 0;
          for (const part of parts) {
            const at = lower.indexOf(part, from);
            if (at < 0) return false;
            from = at + part.length;
          }
          return true;
        })
        .map(({ need }) => need);
      return { functions: needs, errors: mostSpecific(errors) };
    },
  };
}

/** Drops a matched error whose message is contained in another match's, keeping the more specific one. */
function mostSpecific(errors: ErrorNeed[]): ErrorNeed[] {
  return errors.filter((e) => !errors.some((o) => o !== e && o.message.length > e.message.length && o.message.includes(e.message)));
}
