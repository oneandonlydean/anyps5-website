import { leaderboard, stats } from "./boards";
import { isSiteCommand, reply, runSiteCommand, suggest, type Option } from "./commands";
import type { Env, User } from "./env";

const PING = 1;
const APPLICATION_COMMAND = 2;
const AUTOCOMPLETE = 4;
const PONG = 1;
const EPHEMERAL = 64;

interface Interaction {
  type: number;
  data?: { name: string; options?: Option[] };
  member?: { user: { id: string } };
  user?: { id: string };
}

const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));

/** Checks Discord's Ed25519 signature over timestamp + body. */
async function verified(req: Request, env: Env, body: string): Promise<boolean> {
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey("raw", unhex(env.DISCORD_PUBLIC_KEY), "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, unhex(signature), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

const plural = (n: number) => `**${n}** merged pull request${n === 1 ? "" : "s"}`;

const RECENT = 5;

async function prs(env: Env, caller: string, target: string): Promise<Response> {
  const user = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ? AND github_id IS NOT NULL")
    .bind(target)
    .first<User>();
  if (!user) {
    const content =
      target === caller
        ? "You haven't linked a GitHub account yet. Open the server menu, choose **Linked Roles**, and connect."
        : `<@${target}> hasn't linked a GitHub account.`;
    return reply({ content, flags: EPHEMERAL });
  }
  const login = user.github_login!;
  // -1 means the link is saved but the first count has not been pushed yet.
  const count = user.merged_prs < 0 ? "a count that is still syncing" : plural(user.merged_prs);
  const list = `https://github.com/${env.GITHUB_REPO}/pulls?q=${encodeURIComponent(`is:pr is:merged author:${login}`)}`;

  const { results } = await env.DB.prepare(
    "SELECT number, title, merged_at FROM merges WHERE author_id = ? ORDER BY merged_at DESC LIMIT ?",
  )
    .bind(user.github_id, RECENT)
    .all<{ number: number; title: string; merged_at: string }>();
  const recent = results.map(
    (m) =>
      `- [#${m.number}](<https://github.com/${env.GITHUB_REPO}/pull/${m.number}>) ${m.title.slice(0, 100)} \u00b7 <t:${Math.floor(Date.parse(m.merged_at) / 1000)}:R>`,
  );

  return reply({
    content: [
      `<@${target}> has ${count} on [${env.GITHUB_REPO}](<${list}>) as [${login}](<https://github.com/${login}>).`,
      ...(recent.length ? ["", "Most recent:", ...recent] : []),
    ].join("\n"),
    flags: EPHEMERAL,
  });
}

export async function interactions(req: Request, env: Env): Promise<Response> {
  const body = await req.text();
  if (!(await verified(req, env, body))) return new Response("invalid request signature", { status: 401 });

  const interaction = JSON.parse(body) as Interaction;
  if (interaction.type === PING) return Response.json({ type: PONG });

  const caller = interaction.member?.user.id ?? interaction.user?.id;
  if (interaction.type === AUTOCOMPLETE && interaction.data) return suggest(env, interaction.data.name, interaction.data.options, caller);
  if (interaction.type === APPLICATION_COMMAND && caller) {
    if (interaction.data && isSiteCommand(interaction.data.name)) return runSiteCommand(env, interaction.data.name, interaction.data.options, caller);
    if (interaction.data?.name === "prs") {
      const target = interaction.data.options?.find((o) => o.name === "user")?.value ?? caller;
      return prs(env, caller, target);
    }
    if (interaction.data?.name === "leaderboard") {
      const option = (name: string) => interaction.data!.options?.find((o) => o.name === name)?.value ?? "";
      return leaderboard(env, option("board"), option("period"));
    }
    if (interaction.data?.name === "stats") return stats(env);
  }
  return reply({ content: "Unknown command.", flags: EPHEMERAL });
}
