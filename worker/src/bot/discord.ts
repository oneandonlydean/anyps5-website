import { baseUrl, type Ctx } from "./env";
import { HttpError } from "./http";

const API = "https://discord.com/api/v10";

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function authorizeUrl({ env }: Ctx, state: string): string {
  const q = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: `${baseUrl(env)}/discord/callback`,
    response_type: "code",
    scope: "identify role_connections.write",
    prompt: "consent",
    state,
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

function tokenRequest({ env }: Ctx, params: Record<string, string>): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      ...params,
    }),
  };
}

export function exchangeCode(ctx: Ctx, code: string): Promise<Tokens> {
  return ctx.http.json<Tokens>(
    "discord token",
    `${API}/oauth2/token`,
    tokenRequest(ctx, {
      grant_type: "authorization_code",
      code,
      redirect_uri: `${baseUrl(ctx.env)}/discord/callback`,
    }),
  );
}

/**
 * Refreshes a token pair, or returns null if the user has revoked the app.
 * Only `invalid_grant` counts as revoked: a 401 here means our own client
 * credentials are wrong, and must not be mistaken for every user disconnecting.
 */
export async function refresh(ctx: Ctx, refreshToken: string): Promise<Tokens | null> {
  const res = await ctx.http.send(
    "discord refresh",
    `${API}/oauth2/token`,
    tokenRequest(ctx, { grant_type: "refresh_token", refresh_token: refreshToken }),
  );
  if (res.ok) return res.json<Tokens>();
  const body = await res.json<{ error?: string }>().catch(() => ({ error: undefined }));
  if (res.status === 400 && body.error === "invalid_grant") return null;
  throw new HttpError("discord refresh", res.status);
}

export async function userId({ http }: Ctx, accessToken: string): Promise<string> {
  const me = await http.json<{ id: string }>("discord me", `${API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return me.id;
}

/** Pushes role-connection metadata. Returns false if the user's token is no longer accepted. */
export async function putRoleConnection(
  { env, http }: Ctx,
  accessToken: string,
  login: string,
  mergedPrs: number,
): Promise<boolean> {
  const res = await http.send(
    "discord role connection",
    `${API}/users/@me/applications/${env.DISCORD_CLIENT_ID}/role-connection`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        platform_name: "GitHub",
        platform_username: login,
        metadata: { merged_prs: mergedPrs },
      }),
    },
  );
  await res.body?.cancel();
  if (res.status === 401) return false;
  if (!res.ok) throw new HttpError("discord role connection", res.status);
  return true;
}

/** Posts a message to a webhook. `label` names it in errors; the URL is a secret and is never logged. */
export async function postWebhook({ http }: Ctx, label: string, url: string, message: Record<string, unknown>): Promise<void> {
  const res = await http.send(label, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...message }),
  });
  await res.body?.cancel();
  if (!res.ok) throw new HttpError(label, res.status);
}
