import { decrypt, encrypt, importKey } from "../src/bot/crypto";

/**
 * A one-off Worker for the bot's cutover. Deployed under the old bot's name (gh-discord-roles), it inherits that
 * Worker's secrets, including the TOKEN_KEY nobody kept a copy of, and re-encrypts each linked member's Discord
 * tokens with NEW_TOKEN_KEY, the key production uses. Deploying it also replaces the old bot and removes its cron, so
 * nothing refreshes a token with the old key afterwards. Delete the Worker once it has run; see "Going live" in the
 * README.
 */

export interface RekeyEnv {
  DB: D1Database;
  TOKEN_KEY: string;
  NEW_TOKEN_KEY: string;
  /** A one-time password for the request that runs it. */
  REKEY_PASSWORD: string;
}

type Row = { discord_id: string; access_token_enc: string; refresh_token_enc: string };

export interface RekeyResult {
  members: number;
  rekeyed: number;
  /** Already readable with the new key, from an earlier run. */
  already: number;
  /** Readable with neither key; left as they were. Those members link again. */
  unreadable: string[];
  dryRun: boolean;
}

export async function rekey(env: RekeyEnv, dryRun: boolean): Promise<RekeyResult> {
  const oldKey = await importKey(env.TOKEN_KEY);
  const newKey = await importKey(env.NEW_TOKEN_KEY);
  const { results } = await env.DB.prepare("SELECT discord_id, access_token_enc, refresh_token_enc FROM users").all<Row>();
  const result: RekeyResult = { members: results.length, rekeyed: 0, already: 0, unreadable: [], dryRun };
  const updates: D1PreparedStatement[] = [];
  for (const row of results) {
    const tokens = await readable(oldKey, row);
    if (!tokens) {
      if (await readable(newKey, row)) result.already++;
      else result.unreadable.push(row.discord_id);
      continue;
    }
    result.rekeyed++;
    updates.push(
      env.DB.prepare("UPDATE users SET access_token_enc = ?, refresh_token_enc = ? WHERE discord_id = ? AND access_token_enc = ?").bind(
        await encrypt(newKey, tokens.access),
        await encrypt(newKey, tokens.refresh),
        row.discord_id,
        row.access_token_enc,
      ),
    );
  }
  if (!dryRun) for (let i = 0; i < updates.length; i += 50) await env.DB.batch(updates.slice(i, i + 50));
  return result;
}

async function readable(key: CryptoKey, row: Row): Promise<{ access: string; refresh: string } | null> {
  try {
    return { access: await decrypt(key, row.access_token_enc), refresh: await decrypt(key, row.refresh_token_enc) };
  } catch {
    return null;
  }
}

/** Compares without leaking how much of the password matched. */
async function same(a: string, b: string): Promise<boolean> {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  return x.every((v, i) => v === y[i]);
}

export default {
  async fetch(request: Request, env: RekeyEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/rekey") {
      return new Response("This bot has moved to anyps5.gg.\n", { status: 410 });
    }
    const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!env.REKEY_PASSWORD || !env.NEW_TOKEN_KEY || !(await same(given, env.REKEY_PASSWORD))) {
      return new Response("Forbidden\n", { status: 403 });
    }
    return Response.json(await rekey(env, url.searchParams.has("dry-run")));
  },
} satisfies ExportedHandler<RekeyEnv>;
