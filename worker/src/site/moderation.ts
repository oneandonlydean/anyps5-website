import type { Env } from "../bot/env";
import { currentAccount, isMaintainer, type Account } from "./auth";
import { json, nowSeconds, problem, sameOrigin } from "./http";
import { requestRebuild } from "./rebuild";
import { COLUMNS, summarise } from "./reports";

/**
 * Maintainer tools. Each action is listed with what it accepts and what it does, so new ones slot in. Every action
 * is logged with who took it, and the site rebuilds so the change shows.
 */

type Kind = "upload" | "screenshot" | "art" | "account";

interface Action {
  kinds: Kind[];
  apply: (env: Env, kind: Kind, target: string, by: string, reason: string | null) => Promise<boolean>;
}

const hide = (env: Env, kind: Kind, target: string, by: string, reason: string | null) =>
  env.SITE_DB!.prepare("INSERT INTO hidden (kind, target, reason, by_login, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(kind, target, reason, by, nowSeconds()).run();

const setUpload = async (env: Env, target: string, status: string) =>
  ((await env.SITE_DB!.prepare("UPDATE uploads SET status = ? WHERE id = ?").bind(status, Number(target)).run()).meta.changes ?? 0) > 0;

const setBlocked = async (env: Env, login: string, blocked: number) =>
  ((await env.SITE_DB!.prepare("UPDATE accounts SET blocked = ? WHERE lower(login) = lower(?)").bind(blocked, login).run()).meta.changes ?? 0) > 0;

const ACTIONS: Record<string, Action> = {
  approve: { kinds: ["upload"], apply: (env, _k, target) => setUpload(env, target, "visible") },
  hide: {
    kinds: ["upload", "screenshot", "art"],
    apply: async (env, kind, target, by, reason) => (kind === "upload" ? setUpload(env, target, "hidden") : (await hide(env, kind, target, by, reason), true)),
  },
  unhide: {
    kinds: ["upload", "screenshot", "art"],
    apply: async (env, kind, target) =>
      kind === "upload" ? setUpload(env, target, "visible") : ((await env.SITE_DB!.prepare("DELETE FROM hidden WHERE kind = ? AND target = ?").bind(kind, target).run()).meta.changes ?? 0) > 0,
  },
  block: { kinds: ["account"], apply: (env, _k, target) => setBlocked(env, target, 1) },
  unblock: { kinds: ["account"], apply: (env, _k, target) => setBlocked(env, target, 0) },
};

/** Targets: an upload id, an image id, "<game key>:<role>" for art, or a GitHub login. */
const TARGET = /^[A-Za-z0-9_.:-]{1,120}$/;

async function maintainer(req: Request, env: Env): Promise<Account | Response> {
  const account = await currentAccount(req, env);
  if (!account) return problem(401, "Sign in with GitHub first.");
  if (!isMaintainer(env, account.login)) return problem(403, "Only maintainers can do this.");
  return account;
}

export async function act(req: Request, env: Env, wait: (p: Promise<unknown>) => void): Promise<Response> {
  if (!sameOrigin(req)) return problem(403, "Cross-site request refused.");
  const who = await maintainer(req, env);
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => null)) as { action?: string; kind?: Kind; target?: string; reason?: string } | null;
  const action = body?.action ? ACTIONS[body.action] : undefined;
  if (!action || !body?.kind || !action.kinds.includes(body.kind) || !body.target || !TARGET.test(body.target)) return problem(400, "Unknown action.");
  const reason = body.reason?.slice(0, 200) || null;
  const changed = await action.apply(env, body.kind, body.target, who.login, reason);
  if (!changed) return problem(404, "Nothing to change.");
  await env.SITE_DB!.prepare("INSERT INTO moderation_log (action, kind, target, reason, by_login, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(body.action, body.kind, body.target, reason, who.login, nowSeconds())
    .run();
  wait(requestRebuild(env, `${body.action} ${body.kind}`));
  return json({ ok: true });
}

/** What maintainers work from: flagged uploads, the newest uploads, blocked accounts, hidden items and recent actions. */
export async function queue(req: Request, env: Env): Promise<Response> {
  const who = await maintainer(req, env);
  if (who instanceof Response) return who;
  const db = env.SITE_DB!;
  const rows = `SELECT ${COLUMNS}, u.status, u.flags FROM uploads u JOIN accounts a ON a.github_id = u.github_id`;
  type Row = Parameters<typeof summarise>[0] & { status: string; flags: string };
  // Reports stored under the draft format can't be summarised as version 1; they still show, with what is known.
  const withState = (r: Row) => {
    let summary: Partial<ReturnType<typeof summarise>>;
    try {
      summary = summarise(r);
    } catch {
      summary = { id: r.id, titleId: r.title_id, login: r.login, at: new Date(r.created_at * 1000).toISOString(), stage: null };
    }
    return { ...summary, status: r.status, flags: JSON.parse(r.flags) as string[] };
  };
  const [review, recent, blocked, hidden, log] = await Promise.all([
    db.prepare(`${rows} WHERE u.status = 'review' ORDER BY u.id`).all<Row>(),
    db.prepare(`${rows} ORDER BY u.id DESC LIMIT 50`).all<Row>(),
    db.prepare("SELECT login FROM accounts WHERE blocked = 1 ORDER BY login").all<{ login: string }>(),
    db.prepare("SELECT kind, target, reason, by_login, created_at FROM hidden ORDER BY created_at DESC").all(),
    db.prepare("SELECT action, kind, target, reason, by_login, created_at FROM moderation_log ORDER BY id DESC LIMIT 30").all(),
  ]);
  return json({
    review: review.results.map(withState),
    recent: recent.results.map(withState),
    blocked: blocked.results.map((b) => b.login),
    hidden: hidden.results,
    log: log.results,
  });
}
