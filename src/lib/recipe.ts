import type { RunReport } from "./run-report";

/**
 * The run recipe AnyPS5 writes next to its run report (anyps5-recipe.json, added upstream in commit 449a777d): how the
 * run was started, so someone else can repeat it. It holds the run's id, the build commit, the process arguments, the
 * ANYPS5_* variables that were set and the names of the configuration files the run was given. The runtime already
 * puts every value through its filter for user names and paths, and leaves out variables named like secrets.
 *
 * Upstream publishes no schema for it, so the checks here follow the writer (core/libs/prx/libc/src/RunReport.cpp).
 * Unlike the report, fields the site doesn't know are ignored rather than refused, and only the known ones are kept:
 * a new field upstream doesn't stop uploads.
 */
export interface RunRecipe {
  format: "anyps5-recipe";
  version: 1;
  generated: string;
  run: { id: string };
  anyps5: { commit: string | null };
  argv: string[];
  environment: Record<string, string>;
  configFiles: string[];
}

/** The whole file, in bytes of UTF-8; a recipe is a few hundred bytes. */
export const MAX_RECIPE_BYTES = 32_768;
const MAX_ARGS = 64;
const MAX_VARIABLES = 64;
const MAX_FILES = 16;
const MAX_VALUE = 1024;

/** The words upstream refuses in a variable's name (RecipeVariableAllowed); the site applies them again. */
const SECRET = /TOKEN|KEY|PASSWORD|PASSCODE|SECRET|CREDENTIAL|COOKIE|AUTH|SESSION|LOGIN/i;
const VARIABLE = /^ANYPS5_[A-Za-z0-9_]{1,64}$/;

const isText = (v: unknown, max = MAX_VALUE): v is string => typeof v === "string" && v.length <= max;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Checks parsed JSON is a run recipe, and returns it with only the fields the site knows. Variables named like
 * secrets are dropped, and an argument that names a secret has its value replaced, as a second line of defence: the
 * recipe is shown publicly with the report.
 */
export function validateRecipe(data: unknown): { recipe: RunRecipe; issues: [] } | { recipe: null; issues: string[] } {
  const issues: string[] = [];
  const fail = () => ({ recipe: null, issues: issues.slice(0, 5) });
  if (!isObject(data)) return (issues.push("The file isn't a JSON object."), fail());
  if (data.format !== "anyps5-recipe") return (issues.push(`format: expected "anyps5-recipe"${isText(data.format, 40) ? `, got "${data.format}"` : ""}.`), fail());
  if (data.version !== 1) issues.push("version: expected 1.");
  if (!isText(data.generated, 40) || Number.isNaN(Date.parse(data.generated))) issues.push("generated: expected a date.");
  if (!isObject(data.run) || !isText(data.run.id, 32) || !/^[0-9a-f]{32}$/.test(data.run.id)) issues.push("run/id: expected the run's id, 32 hexadecimal digits.");
  if (!isObject(data.anyps5) || (data.anyps5.commit !== null && !(isText(data.anyps5.commit, 40) && /^[0-9a-f]{40}$/.test(data.anyps5.commit))))
    issues.push("anyps5/commit: expected a commit hash or null.");
  const list = (key: "argv" | "configFiles", max: number) => {
    const v = data[key];
    if (!Array.isArray(v) || v.length > max || !v.every((s) => isText(s))) issues.push(`${key}: expected a list of at most ${max} pieces of text.`);
  };
  list("argv", MAX_ARGS);
  list("configFiles", MAX_FILES);
  const env = data.environment;
  if (!isObject(env) || Object.keys(env).length > MAX_VARIABLES || !Object.entries(env).every(([k, v]) => VARIABLE.test(k) && isText(v)))
    issues.push(`environment: expected at most ${MAX_VARIABLES} ANYPS5_ variables with text values.`);
  if (issues.length) return fail();

  const run = data.run as { id: string };
  const anyps5 = data.anyps5 as { commit: string | null };
  return {
    recipe: {
      format: "anyps5-recipe",
      version: 1,
      generated: data.generated as string,
      run: { id: run.id },
      anyps5: { commit: anyps5.commit },
      argv: redactArguments(data.argv as string[]),
      environment: Object.fromEntries(Object.entries(env as Record<string, string>).filter(([k]) => !SECRET.test(k)).sort(([a], [b]) => a.localeCompare(b))),
      configFiles: data.configFiles as string[],
    },
    issues: [],
  };
}

/** `--token=abc` keeps its name and loses its value; `--password abc` loses the argument after the flag. */
function redactArguments(argv: string[]): string[] {
  const named = (s: string) => /^-{1,2}[\w.-]+$/.test(s) && SECRET.test(s);
  return argv.map((arg, i) => {
    const pair = arg.match(/^(-{0,2}[\w.-]+)[=:](.*)$/s);
    if (pair && SECRET.test(pair[1]!)) return `${pair[1]}${arg[pair[1]!.length]}[redacted]`;
    if (i > 0 && named(argv[i - 1]!) && !arg.startsWith("-")) return "[redacted]";
    return arg;
  });
}

/** Contradictions between a recipe and the report it was sent with. */
export function checkRecipe(report: RunReport, recipe: RunRecipe): string[] {
  const errors: string[] = [];
  if (recipe.run.id !== report.run.id) errors.push("The recipe's run id isn't the report's: it was written by another run.");
  if (recipe.anyps5.commit && report.anyps5.commit && recipe.anyps5.commit !== report.anyps5.commit) errors.push("The recipe and the report name different AnyPS5 builds.");
  return errors;
}

/** The arguments as one shell line, quoting any that need it. */
export function commandLine(argv: string[]): string {
  return argv.map((a) => (a !== "" && /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
}

/** The variables as `NAME=value` lines a shell accepts, quoted as needed. */
export function environmentLines(environment: Record<string, string>): string[] {
  return Object.entries(environment).map(([k, v]) => `${k}=${commandLine([v])}`);
}
