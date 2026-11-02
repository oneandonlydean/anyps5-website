/**
 * The site's Worker. Static files come from Cloudflare's assets; this code handles only:
 * - the converter's system library downloads: those archives (~100 MB each) exceed the 25 MiB asset limit, so they
 *   stream from the upstream Pages site instead, as the dev server's proxy does;
 * - the Discord bot: linked roles, slash commands, and a cron that announces merges, releases and game stage rises.
 *   It runs only where its database and secrets are configured (the production environment), so the demo has none;
 * - the site's own features (/auth/*, /api/*): GitHub sign-in, uploaded run reports and maintainer tools, wherever
 *   the site database is bound.
 */
import { runCron } from "./bot/cron";
import { botEnabled, log, type Env } from "./bot/env";
import { HttpError } from "./bot/http";
import { interactions } from "./bot/interactions";
import { discordCallback, githubCallback, linkedRole } from "./bot/link";
import { page } from "./bot/pages";
import { finishSignIn, me, signOut, startSignIn } from "./site/auth";
import { problem } from "./site/http";
import { act, queue } from "./site/moderation";
import { siteCron } from "./site/rebuild";
import { exportData, reportDetail, upload } from "./site/reports";
import { schema } from "./site/schema";

const UPSTREAM = "https://boykopovar.github.io/AnyPS5";
const LIBRARIES = "/convert/app/libraries/";

const BOT_ROUTES: Record<string, (req: Request, env: Env) => Promise<Response>> = {
  "GET /linked-role": linkedRole,
  "GET /discord/callback": discordCallback,
  "GET /github/callback": githubCallback,
  "POST /interactions": interactions,
};

type Wait = (promise: Promise<unknown>) => void;
const SITE_ROUTES: Record<string, (req: Request, env: Env, wait: Wait) => Promise<Response>> = {
  "GET /auth/github": startSignIn,
  "GET /auth/github/callback": finishSignIn,
  "POST /auth/logout": signOut,
  "GET /api/me": me,
  "POST /api/reports": upload,
  "GET /api/export": exportData,
  "GET /api/schema": schema,
  "GET /api/mod/queue": queue,
  "POST /api/mod/action": act,
};

/**
 * Only the converter's archives (.zip) are proxied, as opaque downloads: the content comes from another site but is
 * served on this one, so it must never be able to render as a page.
 */
async function library(request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  if (!url.pathname.endsWith(".zip")) return new Response("Not found", { status: 404 });
  const range = request.headers.get("range");
  const upstream = await fetch(`${UPSTREAM}/libraries/${url.pathname.slice(LIBRARIES.length)}${url.search}`, {
    method: request.method,
    headers: range ? { range } : {},
    // Archives are named by hash, so they are cached for a day; errors are not, so a brief upstream outage clears.
    cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 86400, "300-599": 0 } },
  } as RequestInit);
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", upstream.ok ? "public, max-age=86400" : "no-store");
  headers.set("content-type", "application/octet-stream");
  headers.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(LIBRARIES)) return library(request, url);

    // One upload's report: /api/reports/123.
    const detail = request.method === "GET" && env.SITE_DB ? url.pathname.match(/^\/api\/reports\/([1-9][0-9]{0,9})$/) : null;
    if (detail) return reportDetail(request, env, Number(detail[1])).catch((err) => (log("site_route_failed", { path: url.pathname, error: String(err) }), problem(500, "Something went wrong. Try again.")));

    const site = SITE_ROUTES[`${request.method} ${url.pathname}`];
    if (site && env.SITE_DB) {
      try {
        return await site(request, env, (p) => ctx.waitUntil(p));
      } catch (err) {
        log("site_route_failed", { path: url.pathname, error: String(err) });
        return problem(500, "Something went wrong. Try again.");
      }
    }

    const route = BOT_ROUTES[`${request.method} ${url.pathname}`];
    if (route && botEnabled(env)) {
      try {
        return await route(request, env);
      } catch (err) {
        log("route_failed", { path: url.pathname, error: err instanceof HttpError ? err.message : String(err) });
        return page(502, "Something went wrong", "Linking did not complete. Go back to Discord and press Connect again.");
      }
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime);
    // The site's refresh runs with or without the bot; the bot's own minute also flushes held-back rebuilds.
    await siteCron(env, now);
    if (botEnabled(env)) await runCron(env, now);
  },
} satisfies ExportedHandler<Env>;
