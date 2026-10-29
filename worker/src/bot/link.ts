import * as discord from "./discord";
import { log, makeCtx, now, type Env, type User } from "./env";
import * as github from "./github";
import { page } from "./pages";
import { saveTokens, syncUser } from "./sync";

const COOKIE = "link_state";
const STATE_TTL = 600;

function stateCookie(value: string, maxAge = STATE_TTL): string {
  return `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function redirect(location: string, state: string): Response {
  return new Response(null, { status: 302, headers: { location, "set-cookie": stateCookie(state) } });
}

async function createState(env: Env, discordId: string | null): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO oauth_state (state, discord_id, expires_at) VALUES (?, ?, ?)")
    .bind(state, discordId, now() + STATE_TTL)
    .run();
  return state;
}

/**
 * Consumes the `state` in the query if it matches the cookie and an unexpired
 * row. Returns the row's discord_id (null on the Discord leg), or undefined
 * if the state is not valid.
 */
async function consumeState(req: Request, env: Env): Promise<string | null | undefined> {
  const state = new URL(req.url).searchParams.get("state");
  const cookie = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!state || state !== cookie) return undefined;
  const row = await env.DB.prepare("DELETE FROM oauth_state WHERE state = ? AND expires_at > ? RETURNING discord_id")
    .bind(state, now())
    .first<{ discord_id: string | null }>();
  return row ? row.discord_id : undefined;
}

const expired = () =>
  page(400, "Link expired", "This link has expired or was already used. Go back to Discord and press Connect again.");
const cancelled = () => page(400, "Cancelled", "Nothing was linked. You can start again from Discord at any time.");

export async function linkedRole(_req: Request, env: Env): Promise<Response> {
  const ctx = await makeCtx(env);
  const state = await createState(env, null);
  return redirect(discord.authorizeUrl(ctx, state), state);
}

export async function discordCallback(req: Request, env: Env): Promise<Response> {
  const code = new URL(req.url).searchParams.get("code");
  if ((await consumeState(req, env)) !== null) return expired();
  if (!code) return cancelled();

  const ctx = await makeCtx(env);
  const tokens = await discord.exchangeCode(ctx, code);
  const discordId = await discord.userId(ctx, tokens.access_token);
  await saveTokens(ctx, discordId, tokens);

  // The GitHub leg is cookie-bound too. Otherwise someone could start a link
  // for their own Discord account and send the GitHub URL to a contributor,
  // whose approval would attach the contributor's PRs to the sender.
  const state = await createState(env, discordId);
  return redirect(github.authorizeUrl(ctx, state), state);
}

export async function githubCallback(req: Request, env: Env): Promise<Response> {
  const code = new URL(req.url).searchParams.get("code");
  const discordId = await consumeState(req, env);
  if (!discordId) return expired();
  if (!code) return cancelled();

  const ctx = await makeCtx(env);
  const gh = await github.identify(ctx, code);

  const taken = () =>
    page(
      409,
      "Already linked",
      `The GitHub account ${gh.login} is already linked to a different Discord account. Disconnect it there first.`,
    );
  const other = await env.DB.prepare("SELECT 1 FROM users WHERE github_id = ? AND discord_id != ?")
    .bind(gh.id, discordId)
    .first();
  if (other) return taken();

  // merged_prs = -1 makes the sync below push metadata even if the count is
  // unchanged, and makes a later resync retry if the push fails here.
  let user: User | null;
  try {
    user = await env.DB.prepare(
      "UPDATE users SET github_id = ?, github_login = ?, merged_prs = -1 WHERE discord_id = ? RETURNING *",
    )
      .bind(gh.id, gh.login, discordId)
      .first<User>();
  } catch (err) {
    // Lost a race with another Discord account linking the same GitHub account.
    if (String(err).includes("UNIQUE")) return taken();
    throw err;
  }
  if (!user) return expired();

  const count = await syncUser(ctx, user, gh.login);
  if (count === null) return expired();
  log("linked", { discord_id: discordId, github_id: gh.id, merged_prs: count });

  const res = page(
    200,
    "Linked",
    `Linked to GitHub account ${gh.login} with ${count} merged pull request${count === 1 ? "" : "s"}. You can close this tab and return to Discord.`,
  );
  res.headers.set("set-cookie", stateCookie("", 0));
  return res;
}
