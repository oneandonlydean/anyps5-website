/** One entry from GitHub's contributors API with `anon=1`: an account, or a commit author email without one. */
export interface ContributorEntry {
  type: string;
  login?: string;
  name?: string;
  email?: string;
  contributions: number;
}

/** Coding agents that author commits under their own names; they are tools, not contributors. */
const AGENTS = new Set(["claude", "claudecode", "codex", "cursoragent", "copilot", "githubcopilot", "devin", "githubactions", "dependabot", "renovate"]);

const norm = (text: string | undefined) => (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * How many people have authored commits. GitHub lists authors without an account once per email address, so the
 * same person can appear several times: anonymous entries count once per name, and not at all when their name or
 * their `<id>+<login>@users.noreply.github.com` address matches an account already counted. Bots and coding agents
 * are left out.
 */
export function countPeople(entries: ContributorEntry[]): number {
  const human = (e: ContributorEntry) => e.type !== "Bot" && !e.login?.endsWith("[bot]") && !AGENTS.has(norm(e.login ?? e.name));
  const accounts = new Set(entries.filter((e) => e.type !== "Anonymous" && e.login && human(e)).map((e) => norm(e.login)));
  const seen = new Set(accounts);
  let anonymous = 0;
  for (const e of entries) {
    if (e.type !== "Anonymous" || !human(e)) continue;
    const noreply = e.email?.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i)?.[1];
    const key = norm(noreply) || norm(e.name) || norm(e.email);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    anonymous++;
  }
  return accounts.size + anonymous;
}
