import type { Env } from "../bot/env";
import { cookie, json, nowSeconds, problem, randomToken, sameOrigin, setCookie, sha256 } from "./http";

/**
 * "Sign in with GitHub" for the site. Only the GitHub identity is used (no scopes, and the GitHub token is dropped
 * once the account is known); the site keeps its own session, a random cookie whose hash is stored.
 */

const SESSION = "session";
const STATE = "login_state";
const SESSION_DAYS = 30;
const STATE_TTL = 600;

export interface Account {
  github_id: number;
  login: string;
  avatar: string | null;
  blocked: number;
}

export const signInEnabled = (env: Env) => Boolean(env.SITE_DB && env.SITE_GITHUB_CLIENT_ID && env.SITE_GITHUB_CLIENT_SECRET);

export const isMaintainer = (env: Env, login: string) =>
  (env.MAINTAINERS ?? "")
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .includes(login.toLowerCase());

/** The signed-in account for a request, or null. */
export async function currentAccount(req: Request, env: Env): Promise<Account | null> {
  const token = cookie(req, SESSION);
  if (!token || !env.SITE_DB) return null;
  return env.SITE_DB.prepare(
    "SELECT a.github_id, a.login, a.avatar, a.blocked FROM sessions s JOIN accounts a ON a.github_id = s.github_id WHERE s.id_hash = ? AND s.expires_at > ?",
  )
    .bind(await sha256(token), nowSeconds())
    .first<Account>();
}

/** Only same-site paths, so sign-in can't be used to send people elsewhere. */
const safeReturn = (path: string | null) => (path && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : "/report");

export async function startSignIn(req: Request, env: Env): Promise<Response> {
  if (!signInEnabled(env)) return problem(503, "Signing in is not set up on this site yet.");
  const url = new URL(req.url);
  const state = randomToken();
  await env.SITE_DB!.prepare("INSERT INTO login_state (state, return_to, expires_at) VALUES (?, ?, ?)")
    .bind(state, safeReturn(url.searchParams.get("return")), nowSeconds() + STATE_TTL)
    .run();
  const q = new URLSearchParams({ client_id: env.SITE_GITHUB_CLIENT_ID!, redirect_uri: `${url.origin}/auth/github/callback`, state, allow_signup: "true" });
  return new Response(null, { status: 302, headers: { location: `https://github.com/login/oauth/authorize?${q}`, "set-cookie": setCookie(STATE, state, STATE_TTL) } });
}

export async function finishSignIn(req: Request, env: Env): Promise<Response> {
  if (!signInEnabled(env)) return problem(503, "Signing in is not set up on this site yet.");
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || state !== cookie(req, STATE)) return problem(400, "This sign-in link has expired. Start again.");
  const row = await env.SITE_DB!.prepare("DELETE FROM login_state WHERE state = ? AND expires_at > ? RETURNING return_to")
    .bind(state, nowSeconds())
    .first<{ return_to: string }>();
  if (!row) return problem(400, "This sign-in link has expired. Start again.");
  if (!code) return redirect(row.return_to);

  const token = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json" },
    body: new URLSearchParams({ client_id: env.SITE_GITHUB_CLIENT_ID!, client_secret: env.SITE_GITHUB_CLIENT_SECRET!, code, redirect_uri: `${url.origin}/auth/github/callback` }),
  }).then((r) => r.json<{ access_token?: string }>());
  if (!token.access_token) return problem(400, "GitHub did not accept the sign-in. Start again.");
  const user = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json", "user-agent": "anyps5-website" },
  });
  if (!user.ok) return problem(502, "GitHub could not be reached. Try again.");
  const { id, login, avatar_url } = await user.json<{ id: number; login: string; avatar_url: string }>();

  const session = randomToken();
  const t = nowSeconds();
  await env.SITE_DB!.batch([
    env.SITE_DB!.prepare(
      "INSERT INTO accounts (github_id, login, avatar, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(github_id) DO UPDATE SET login = excluded.login, avatar = excluded.avatar",
    ).bind(id, login, avatar_url, t),
    env.SITE_DB!.prepare("INSERT INTO sessions (id_hash, github_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(session), id, t + SESSION_DAYS * 86400),
    env.SITE_DB!.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
  ]);
  const res = redirect(row.return_to);
  res.headers.append("set-cookie", setCookie(SESSION, session, SESSION_DAYS * 86400));
  res.headers.append("set-cookie", setCookie(STATE, "", 0));
  return res;
}

export async function signOut(req: Request, env: Env): Promise<Response> {
  if (!sameOrigin(req)) return problem(403, "Cross-site request refused.");
  const token = cookie(req, SESSION);
  if (token && env.SITE_DB) await env.SITE_DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": setCookie(SESSION, "", 0) });
}

/** Who is signed in, for the pages' scripts. */
export async function me(req: Request, env: Env): Promise<Response> {
  const account = await currentAccount(req, env);
  if (!account) return json({ signedIn: false, signInAvailable: signInEnabled(env) });
  return json({ signedIn: true, login: account.login, avatar: account.avatar, maintainer: isMaintainer(env, account.login), blocked: account.blocked === 1 });
}

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
