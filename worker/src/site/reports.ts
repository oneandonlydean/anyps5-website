import { checkReport, MAX_REPORT_BYTES, RunReport, SITE_STAGE, type UpstreamFacts } from "../../../src/lib/run-report";
import type { Env } from "../bot/env";
import { currentAccount } from "./auth";
import { json, nowSeconds, problem, sameOrigin, sha256 } from "./http";
import { requestRebuild } from "./rebuild";

const PER_DAY = 30;
const FACTS_TTL = 600_000;
let facts: { at: number; value: UpstreamFacts } | undefined;

/** Implemented functions and untranslated instructions, from the site's own build; empty when unavailable. */
async function upstreamFacts(env: Env, origin: string): Promise<UpstreamFacts> {
  if (facts && Date.now() - facts.at < FACTS_TTL) return facts.value;
  let value: UpstreamFacts = { implemented: () => undefined, untranslated: new Set() };
  try {
    const res = env.ASSETS ? await env.ASSETS.fetch(`${origin}/progress/facts.json`) : null;
    if (res?.ok) {
      const data = await res.json<{ implemented: string[]; untranslated: string[] }>();
      const done = new Set(data.implemented);
      value = { implemented: (name) => (done.size ? done.has(name) : undefined), untranslated: new Set(data.untranslated.map((o) => o.toUpperCase())) };
    }
  } catch {}
  facts = { at: Date.now(), value };
  return value;
}

/** Takes a run report from a signed-in account: validated, checked against upstream, and stored once. */
export async function upload(req: Request, env: Env, wait: (p: Promise<unknown>) => void): Promise<Response> {
  if (!sameOrigin(req)) return problem(403, "Cross-site request refused.");
  const account = await currentAccount(req, env);
  if (!account) return problem(401, "Sign in with GitHub to upload a report.");
  if (account.blocked) return problem(403, "This account can't upload reports.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REPORT_BYTES) return problem(413, "A report is at most 64 KB.");
  const body = await req.text();
  if (body.length > MAX_REPORT_BYTES) return problem(413, "A report is at most 64 KB.");

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return problem(400, "That file isn't JSON. Upload the anyps5-report.json AnyPS5 wrote.");
  }
  const parsed = RunReport.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "report"}: ${i.message}`);
    return json({ error: "This isn't a valid AnyPS5 run report.", issues }, 400);
  }
  const report = parsed.data;
  const { errors, flags } = checkReport(report, await upstreamFacts(env, new URL(req.url).origin));
  if (errors.length) return json({ error: "This report contradicts itself.", issues: errors }, 400);

  const db = env.SITE_DB!;
  const today = await db.prepare("SELECT count(*) AS n FROM uploads WHERE github_id = ? AND created_at > ?").bind(account.github_id, nowSeconds() - 86400).first<number>("n");
  if ((today ?? 0) >= PER_DAY) return problem(429, `At most ${PER_DAY} reports a day. Try again tomorrow.`);

  const stored = JSON.stringify(report);
  const digest = await sha256(stored);
  if (await db.prepare("SELECT 1 FROM uploads WHERE digest = ?").bind(digest).first()) return problem(409, "This report was already uploaded.");
  const status = flags.length ? "review" : "visible";
  const row = await db
    .prepare("INSERT INTO uploads (github_id, title_id, stage, commit_sha, report, digest, flags, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(account.github_id, report.game.titleId, report.run.stage, report.anyps5.commit, stored, digest, JSON.stringify(flags), status, nowSeconds())
    .first<number>("id");
  if (status === "visible") wait(requestRebuild(env, "upload"));
  return json({ id: row, status, flags, titleId: report.game.titleId, stage: SITE_STAGE[report.run.stage] }, 201);
}

export interface UploadSummary {
  id: number;
  titleId: string;
  stage: string;
  login: string;
  githubId: number;
  at: string;
  os: string;
  gpuVendor: string;
  commit: string;
  release: string | null;
  contentVersion: string | null;
  exit: string;
  missing: string[];
  unsupported: string[];
  stop: { kind: string; message: string | null };
}

export function summarise(row: { id: number; report: string; login: string; github_id: number; created_at: number }): UploadSummary {
  const r = RunReport.parse(JSON.parse(row.report));
  return {
    id: row.id,
    titleId: r.game.titleId,
    stage: SITE_STAGE[r.run.stage] as string,
    login: row.login,
    githubId: row.github_id,
    at: new Date(row.created_at * 1000).toISOString(),
    os: r.system.os,
    gpuVendor: r.system.gpu.vendor,
    commit: r.anyps5.commit,
    release: r.anyps5.release ?? null,
    contentVersion: r.game.contentVersion ?? null,
    exit: r.run.exit,
    missing: [...r.missing.functions].sort((a, b) => b.calls - a.calls).slice(0, 20).map((f) => f.name),
    unsupported: [...r.shaders.unsupported].sort((a, b) => b.count - a.count).slice(0, 20).map((u) => `${u.encoding} ${u.opcode}`),
    stop: { kind: r.stop.kind, message: r.stop.message ?? null },
  };
}

/** Everything the site build needs: visible uploads from accounts in good standing, and what maintainers hid. */
export async function exportData(_req: Request, env: Env): Promise<Response> {
  const db = env.SITE_DB!;
  const [uploads, hidden] = await Promise.all([
    db
      .prepare("SELECT u.id, u.report, u.github_id, u.created_at, a.login FROM uploads u JOIN accounts a ON a.github_id = u.github_id WHERE u.status = 'visible' AND a.blocked = 0 ORDER BY u.id")
      .all<{ id: number; report: string; github_id: number; created_at: number; login: string }>(),
    db.prepare("SELECT kind, target FROM hidden").all<{ kind: string; target: string }>(),
  ]);
  return json(
    {
      generated: new Date().toISOString(),
      uploads: uploads.results.map(summarise),
      hidden: {
        screenshots: hidden.results.filter((h) => h.kind === "screenshot").map((h) => h.target),
        art: hidden.results.filter((h) => h.kind === "art").map((h) => h.target),
      },
    },
    200,
    { "cache-control": "public, max-age=60" },
  );
}

