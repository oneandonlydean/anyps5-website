import { checkReport, MAX_REPORT_BYTES, SITE_STAGE, validateRunReport, type RunReport, type UpstreamFacts } from "../../../src/lib/run-report";
import type { Env } from "../bot/env";
import { currentAccount } from "./auth";
import { json, nowSeconds, problem, sameOrigin, sha256 } from "./http";
import { requestRebuild } from "./rebuild";

const PER_DAY = 30;
const FACTS_TTL = 600_000;
/** The title IDs the site lists games under (src/lib/schema.ts): PS5 and PS4 games. */
const TITLE_ID = /^(PPSA|CUSA)[0-9]{5}$/;
/**
 * A run report records stages up to Presents; whether a menu responds or gameplay is reached takes someone watching.
 * The uploader can say so for a run that presented frames, and like any upload it counts once someone confirms it.
 */
const STATED: Record<string, string> = { menus: "Menus", ingame: "Ingame", playable: "Playable" };

interface Facts extends UpstreamFacts {
  /** Title IDs of games the site knows; empty when unavailable. */
  titleIds: Set<string>;
}
let facts: { at: number; value: Facts } | undefined;

/** Implemented functions, untranslated instructions and known games, from the site's own build; empty when unavailable. */
async function upstreamFacts(env: Env, origin: string): Promise<Facts> {
  if (facts && Date.now() - facts.at < FACTS_TTL) return facts.value;
  let value: Facts = { implemented: () => undefined, untranslated: new Set(), titleIds: new Set() };
  try {
    const res = env.ASSETS ? await env.ASSETS.fetch(`${origin}/progress/facts.json`) : null;
    if (res?.ok) {
      const data = await res.json<{ implemented: string[]; untranslated: string[]; titleIds?: string[] }>();
      const done = new Set(data.implemented);
      value = {
        implemented: (name) => (done.size ? done.has(name) : undefined),
        untranslated: new Set(data.untranslated.map((o) => o.toUpperCase())),
        titleIds: new Set(data.titleIds ?? []),
      };
    }
  } catch {}
  // A failed fetch isn't kept, so the next upload tries again.
  if (value.titleIds.size) facts = { at: Date.now(), value };
  return value;
}

/**
 * Takes a run report from a signed-in account: at most 64 KiB, valid against the run report schema, consistent, and
 * stored once per run. A report without a title ID needs `?titleId=` naming the game the uploader chose.
 */
export async function upload(req: Request, env: Env, wait: (p: Promise<unknown>) => void): Promise<Response> {
  if (!sameOrigin(req)) return problem(403, "Cross-site request refused.");
  const account = await currentAccount(req, env);
  if (!account) return problem(401, "Sign in with GitHub to upload a report.");
  if (account.blocked) return problem(403, "This account can't upload reports.");
  const tooBig = () => problem(413, "A run report is at most 64 KB.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REPORT_BYTES) return tooBig();
  const bytes = await readLimited(req, MAX_REPORT_BYTES);
  if (!bytes) return tooBig();

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return problem(400, "That file isn't JSON. Upload the anyps5-report.json AnyPS5 wrote.");
  }
  const { report, issues } = validateRunReport(data);
  if (!report) return json({ error: "This isn't a valid AnyPS5 run report.", issues }, 400);
  const known = await upstreamFacts(env, new URL(req.url).origin);
  const { errors, flags } = checkReport(report, known);
  if (errors.length) return json({ error: "This report contradicts itself.", issues: errors }, 400);

  // A converted game without its metadata has no title ID; the uploader says which game it was.
  const params = new URL(req.url).searchParams;
  const chosen = params.get("titleId")?.toUpperCase() ?? null;
  const titleId = report.game.titleId ?? chosen;
  if (!titleId) return json({ error: "This report doesn't say which game it was. Choose the game, then upload again.", needsGame: true }, 400);
  // A chosen game that isn't on the list yet needs its name, and a maintainer checks the two match before it shows.
  let titleName: string | null = null;
  if (!report.game.titleId) {
    if (!TITLE_ID.test(titleId)) return problem(400, "That isn't a PS5 or PS4 title ID. It's PPSA or CUSA and five digits, like PPSA12345.");
    const given = params.get("name")?.trim().slice(0, 120) || null;
    if (known.titleIds.size === 0) {
      // The list couldn't be read, so whether the game is on it is unknown: keep any name given and let a maintainer check.
      titleName = given;
      flags.push(`Chosen game ${titleId}${given ? ` (named ${given})` : ""}; the compatibility list couldn't be checked. Check the title ID is listed or named.`);
    } else if (!known.titleIds.has(titleId)) {
      titleName = given;
      if (!titleName) return json({ error: "This game isn't on the compatibility list yet. Give its name too.", needsName: true }, 400);
      flags.push(`A game not on the list yet, named by the uploader: ${titleName} (${titleId}). Check the title ID is that game.`);
    }
  }

  const reached = params.get("reached");
  const stated = reached ? (STATED[reached] ?? null) : null;
  if (reached && !stated) return problem(400, "How far it got is one of menus, ingame or playable.");
  if (stated && report.run.stage !== "presents") return problem(400, "This run didn't present any frames, so it can't have reached a menu or gameplay.");

  const db = env.SITE_DB!;
  const today = await db.prepare("SELECT count(*) AS n FROM uploads WHERE github_id = ? AND created_at > ?").bind(account.github_id, nowSeconds() - 86400).first<number>("n");
  if ((today ?? 0) >= PER_DAY) return problem(429, `At most ${PER_DAY} reports a day. Try again tomorrow.`);

  const stored = JSON.stringify(report);
  const digest = await sha256(stored);
  if (await db.prepare("SELECT 1 FROM uploads WHERE digest = ? OR run_id = ?").bind(digest, report.run.id).first()) return problem(409, "This run was already uploaded.");
  const status = flags.length ? "review" : "visible";
  let row: number | null;
  try {
    row = await db
    .prepare(
      "INSERT INTO uploads (github_id, title_id, stage, commit_sha, report, digest, flags, status, created_at, run_id, title_chosen, title_name, stated_stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(account.github_id, titleId, report.run.stage, report.anyps5.commit ?? "", stored, digest, JSON.stringify(flags), status, nowSeconds(), report.run.id, report.game.titleId ? 0 : 1, titleName, stated)
    .first<number>("id");
  } catch (err) {
    // The same run sent twice at once: the second insert hits the unique index.
    if (String(err).includes("UNIQUE")) return problem(409, "This run was already uploaded.");
    throw err;
  }
  if (status === "visible") wait(requestRebuild(env, "upload"));
  return json({ id: row, status, flags, titleId, stage: stated ?? SITE_STAGE[report.run.stage] }, 201);
}

/** The body, or null once it passes `limit` bytes; read as a stream, so an oversized upload is never held in full. */
async function readLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export interface UploadSummary {
  id: number;
  titleId: string;
  /** The report had no title ID; the uploader chose the game. */
  titleChosen: boolean;
  /** The game's name: as the run report gives it, or as the uploader gave it for a game not on the list yet. */
  name: string | null;
  /** The compatibility list's stage, or null when the run's stage is unknown: the uploader's, when they gave one. */
  stage: string | null;
  /** The stage the uploader said the run reached, past what the report records; null when they didn't say. */
  stated: string | null;
  login: string;
  githubId: number;
  at: string;
  os: string | null;
  gpuVendor: string | null;
  /** The GPU's model name, as the driver reports it. */
  gpu: string | null;
  commit: string | null;
  release: string | null;
  contentVersion: string | null;
  exit: string;
  recovered: boolean;
  /** Top entries of each list; null when the runtime didn't collect that section in this run. */
  missing: string[] | null;
  unsupported: string[] | null;
  /** Entries the runtime dropped from each list to keep the file small. */
  truncated: { functions: number; unsupported: number };
  stop: { kind: string; reason: string; message: string };
}

type Row = { id: number; report: string; login: string; github_id: number; created_at: number; title_id: string; title_chosen: number; title_name: string | null; stated_stage: string | null };

export function summarise(row: Row): UploadSummary {
  const r = JSON.parse(row.report) as RunReport;
  const instruction = (u: RunReport["shaders"]["unsupported"][number]) => [u.encoding, u.opcode ?? (u.opcodeValue !== null ? `#${u.opcodeValue}` : null)].filter(Boolean).join(" ") || "unknown";
  return {
    id: row.id,
    titleId: row.title_id,
    titleChosen: row.title_chosen === 1,
    name: row.title_name ?? (row.title_chosen === 1 ? null : r.game.name?.trim().slice(0, 120) || null),
    stage: row.stated_stage ?? SITE_STAGE[r.run.stage],
    stated: row.stated_stage,
    login: row.login,
    githubId: row.github_id,
    at: new Date(row.created_at * 1000).toISOString(),
    os: r.system.os,
    gpuVendor: r.system.gpu?.vendor ?? null,
    gpu: r.system.gpu?.name ?? null,
    commit: r.anyps5.commit,
    release: r.anyps5.release,
    contentVersion: r.game.contentVersion,
    exit: r.run.exit,
    recovered: r.run.recovered,
    missing: r.coverage.missing ? r.missing.functions.slice(0, 20).map((f) => f.name) : null,
    unsupported: r.coverage.unsupported ? r.shaders.unsupported.slice(0, 20).map(instruction) : null,
    truncated: { functions: r.truncated.functions, unsupported: r.truncated.unsupported },
    stop: { kind: r.stop.kind, reason: r.stop.reason, message: r.stop.message },
  };
}

const COLUMNS = "u.id, u.report, u.github_id, u.created_at, u.title_id, u.title_chosen, u.title_name, u.stated_stage, a.login";

/** Everything the site build needs: visible uploads from accounts in good standing, and what maintainers hid. */
export async function exportData(_req: Request, env: Env): Promise<Response> {
  const db = env.SITE_DB!;
  const [uploads, hidden] = await Promise.all([
    db.prepare(`SELECT ${COLUMNS} FROM uploads u JOIN accounts a ON a.github_id = u.github_id WHERE u.status = 'visible' AND a.blocked = 0 ORDER BY u.id`).all<Row>(),
    db.prepare("SELECT kind, target FROM hidden").all<{ kind: string; target: string }>(),
  ]);
  return json(
    {
      generated: new Date().toISOString(),
      // Reports stored under the draft format can't be read as version 1; they are left out.
      uploads: uploads.results.flatMap((row) => {
        try {
          return [summarise(row)];
        } catch {
          return [];
        }
      }),
      hidden: {
        screenshots: hidden.results.filter((h) => h.kind === "screenshot").map((h) => h.target),
        art: hidden.results.filter((h) => h.kind === "art").map((h) => h.target),
      },
    },
    200,
    { "cache-control": "public, max-age=60" },
  );
}

/**
 * One upload's whole report, for the game page's report details: only a visible upload from an account in good
 * standing, so a hidden or flagged report never leaks through its id.
 */
export async function reportDetail(_req: Request, env: Env, id: number): Promise<Response> {
  const row = await env
    .SITE_DB!.prepare(`SELECT ${COLUMNS} FROM uploads u JOIN accounts a ON a.github_id = u.github_id WHERE u.id = ? AND u.status = 'visible' AND a.blocked = 0`)
    .bind(id)
    .first<Row>();
  if (!row) return problem(404, "No report with that number.");
  return json(
    { id: row.id, titleId: row.title_id, titleChosen: row.title_chosen === 1, login: row.login, at: new Date(row.created_at * 1000).toISOString(), report: JSON.parse(row.report) },
    200,
    { "cache-control": "public, max-age=300" },
  );
}

export { COLUMNS };
