import { decrypt, encrypt } from "./crypto";
import * as discord from "./discord";
import { log, now, type Ctx, type User } from "./env";
import * as github from "./github";

const REFRESH_WITHIN = 24 * 60 * 60;

export async function saveTokens(ctx: Ctx, discordId: string, tokens: discord.Tokens): Promise<void> {
  const t = now();
  await ctx.env.DB.prepare(
    `INSERT INTO users (discord_id, access_token_enc, refresh_token_enc, token_expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(discord_id) DO UPDATE SET
       access_token_enc = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc,
       token_expires_at = excluded.token_expires_at`,
  )
    .bind(
      discordId,
      await encrypt(ctx.key, tokens.access_token),
      await encrypt(ctx.key, tokens.refresh_token),
      t + tokens.expires_in,
      t,
    )
    .run();
}

async function removeUser(ctx: Ctx, user: User, reason: string): Promise<void> {
  await ctx.env.DB.prepare("DELETE FROM users WHERE discord_id = ?").bind(user.discord_id).run();
  log("user_removed", { discord_id: user.discord_id, reason });
}

/** A usable access token, refreshed if it expires within a day. Null if the user revoked the app. */
async function accessToken(ctx: Ctx, user: User): Promise<string | null> {
  if (user.token_expires_at - now() > REFRESH_WITHIN) return decrypt(ctx.key, user.access_token_enc);
  const tokens = await discord.refresh(ctx, await decrypt(ctx.key, user.refresh_token_enc));
  if (!tokens) return null;
  await saveTokens(ctx, user.discord_id, tokens);
  return tokens.access_token;
}

/**
 * Recounts a linked user's merged PRs and pushes the metadata to Discord if
 * the count or login changed. Returns the count, or null if the user had
 * disconnected the app and their row was deleted.
 *
 * `currentLogin` is the login as just reported by GitHub, when the caller has
 * one; otherwise the stored login is used and re-resolved by id if it looks stale.
 */
export async function syncUser(ctx: Ctx, user: User, currentLogin?: string): Promise<number | null> {
  if (user.github_id === null) throw new Error("syncUser called for an unlinked user");

  const token = await accessToken(ctx, user);
  if (token === null) {
    await removeUser(ctx, user, "refresh_revoked");
    return null;
  }

  let login = currentLogin ?? user.github_login ?? "";
  let count = await github.countMergedPrs(ctx, login);
  if (!currentLogin && (count === null || (count === 0 && user.merged_prs > 0))) {
    const renamed = await github.loginById(ctx, user.github_id);
    if (renamed && renamed !== login) {
      login = renamed;
      count = await github.countMergedPrs(ctx, login);
    }
  }
  count ??= 0;

  if (count !== user.merged_prs || login !== user.github_login) {
    if (!(await discord.putRoleConnection(ctx, token, login, count))) {
      await removeUser(ctx, user, "token_rejected");
      return null;
    }
    log("metadata_pushed", { discord_id: user.discord_id, merged_prs: count });
  }

  await ctx.env.DB.prepare("UPDATE users SET github_login = ?, merged_prs = ?, synced_at = ? WHERE discord_id = ?")
    .bind(login, count, now(), user.discord_id)
    .run();
  return count;
}
