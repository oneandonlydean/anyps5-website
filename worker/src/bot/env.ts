import { Http } from "./http";
import { importKey } from "./crypto";

export interface Env {
  /** The site's static files; absent in tests. */
  ASSETS?: Fetcher;
  DB: D1Database;
  GITHUB_REPO: string;
  BASE_URL: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_BOT_TOKEN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_TOKEN: string;
  /** Where merge announcements go when DISCORD_WEBHOOK_PROGRESS is not set. */
  DISCORD_WEBHOOK_URL: string;
  /** Features, fixes and speed-ups merged into the product. */
  DISCORD_WEBHOOK_PROGRESS?: string;
  /** Other merges (tests, docs, tooling); left unannounced when not set. */
  DISCORD_WEBHOOK_DEV?: string;
  /** New releases. */
  DISCORD_WEBHOOK_RELEASES?: string;
  /** Games reaching a new stage on the compatibility list. */
  DISCORD_WEBHOOK_GAMES?: string;
  TOKEN_KEY: string;

  // The site's own features: GitHub sign-in, uploaded run reports, maintainer tools.
  /** The site's database (accounts, uploads, what maintainers hid). Without it, those features are off. */
  SITE_DB?: D1Database;
  /** A GitHub OAuth app for signing in to the site (callback: <site>/auth/github/callback). */
  SITE_GITHUB_CLIENT_ID?: string;
  SITE_GITHUB_CLIENT_SECRET?: string;
  /** Comma-separated GitHub logins that get the maintainer tools. */
  MAINTAINERS?: string;
  /** A token allowed to start the site repository's "Update site" workflow, and that repository ("owner/name"). */
  SITE_DISPATCH_TOKEN?: string;
  SITE_REPO?: string;
}

/** The bot runs only where its database and token key are configured; the demo deploy has neither. */
export const botEnabled = (env: Partial<Env>): boolean => Boolean(env.DB && env.TOKEN_KEY);

export interface User {
  discord_id: string;
  github_id: number | null;
  github_login: string | null;
  merged_prs: number;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: number;
  synced_at: number;
  created_at: number;
}

/** Per-invocation context. */
export interface Ctx {
  env: Env;
  http: Http;
  key: CryptoKey;
}

export async function makeCtx(env: Env, subrequestLimit?: number): Promise<Ctx> {
  return { env, http: new Http(subrequestLimit), key: await importKey(env.TOKEN_KEY) };
}

export const now = () => Math.floor(Date.now() / 1000);

export const baseUrl = (env: Env) => env.BASE_URL.replace(/\/+$/, "");

/** Structured log line. Never pass tokens, codes or the webhook URL. */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}
