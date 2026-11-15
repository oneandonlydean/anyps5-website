import { benchRequired, benchStats, checkBench, MAX_BENCH_BYTES, readBench, type BenchStats } from "../../../src/lib/bench";
import { checkRecipe, MAX_RECIPE_BYTES, validateRecipe, type RunRecipe } from "../../../src/lib/recipe";
import { checkReport, MAX_REPORT_BYTES, SITE_STAGE, validateRunReport, type RunReport, type UpstreamFacts } from "../../../src/lib/run-report";
import type { Env } from "../bot/env";
import { currentAccount, isMaintainer } from "./auth";
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

/** Room for the two parts' headers and boundaries of a multipart upload. */
const FORM_OVERHEAD = 16_384;

/**
 * Takes a run report from a signed-in account: at most 64 KiB, valid against the run report schema, consistent, and
 * stored once per run. A report without a title ID needs `?titleId=` naming the game the uploader chose. The body is
 * the report as JSON, or a form with the report as `report`, its frame-time file (aps5-bench-….json.gz) as `bench` and
 * its run recipe (anyps5-recipe.json) as `recipe`. A run that presented frames for a minute needs the frame-time file,
 * and the site's frame rate comes from it; the recipe is optional and shows with the report.
 */
export async function upload(req: Request, env: Env, wait: (p: Promise<unknown>) => void): Promise<Response> {
  if (!sameOrigin(req)) return problem(403, "Cross-site request refused.");
  const account = await currentAccount(req, env);
  if (!account) return problem(401, "Sign in with GitHub to upload a report.");
  if (account.blocked) return problem(403, "This account can't upload reports.");
  const form = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
  const limit = form ? MAX_REPORT_BYTES + MAX_BENCH_BYTES + MAX_RECIPE_BYTES + FORM_OVERHEAD : MAX_REPORT_BYTES;
  const tooBig = () => problem(413, form ? "A run report is at most 64 KB, and its frame-time file at most 8 MB." : "A run report is at most 64 KB.");
  if (Number(req.headers.get("content-length") ?? 0) > limit) return tooBig();
  const body = await readLimited(req, limit);
  if (!body) return tooBig();

  let bytes: Uint8Array = body;
  let benchBytes: Uint8Array | null = null;
  let recipeBytes: Uint8Array | null = null;
  if (form) {
    let parts: FormData;
    try {
      parts = await new Response(body, { headers: { "content-type": req.headers.get("content-type")! } }).formData();
    } catch {
      return problem(400, "The upload couldn't be read. Try again.");
    }
    const part = async (name: string) => {
      const value = parts.get(name) as unknown;
      if (value === null) return null;
      return typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(await (value as Blob).arrayBuffer());
    };
    const report = await part("report");
    if (!report) return problem(400, "The upload has no run report. Choose the anyps5-report.json AnyPS5 wrote.");
    if (report.length > MAX_REPORT_BYTES) return problem(413, "A run report is at most 64 KB.");
    bytes = report;
    benchBytes = await part("bench");
    if (benchBytes && benchBytes.length > MAX_BENCH_BYTES) return problem(413, "A frame-time file is at most 8 MB.");
    recipeBytes = await part("recipe");
    if (recipeBytes && recipeBytes.length > MAX_RECIPE_BYTES) return problem(413, "A run recipe is at most 32 KB.");
  }

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

  // The frame rate is measured from the frame times, never taken from the report.
  let bench: { stats: BenchStats; digest: string } | null = null;
  if (benchBytes?.length) {
    const read = await readBench(benchBytes);
    if (!read.bench) return json({ error: "This isn't a valid AnyPS5 frame-time file.", issues: read.issues, needsBench: true }, 400);
    const matched = checkBench(report, read.bench);
    if (matched.errors.length) return json({ error: "This frame-time file isn't from this run.", issues: matched.errors, needsBench: true }, 400);
    flags.push(...matched.flags);
    bench = { stats: benchStats(read.bench), digest: await sha256(read.text) };
  } else if (benchRequired(report)) {
    return json(
      {
        error: "This run presented frames, so it needs its frame-time file too: the aps5-bench-….json.gz AnyPS5 writes when started with APS5_TRACE_SUMMARY_EVERY=30 APS5_TRACE_BENCH=1.",
        needsBench: true,
      },
      400,
    );
  }

  // How the run was started: optional, but when it's sent it must be a recipe from this run.
  let recipe: RunRecipe | null = null;
  if (recipeBytes?.length) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(recipeBytes));
    } catch {
      return json({ error: "The run recipe isn't JSON. Send the anyps5-recipe.json AnyPS5 wrote, or leave it out.", badRecipe: true }, 400);
    }
    const read = validateRecipe(parsed);
    if (!read.recipe) return json({ error: "This isn't a valid AnyPS5 run recipe.", issues: read.issues, badRecipe: true }, 400);
    const mismatch = checkRecipe(report, read.recipe);
    if (mismatch.length) return json({ error: "This run recipe isn't from this run.", issues: mismatch, badRecipe: true }, 400);
    recipe = read.recipe;
  }

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
  if (bench && (await db.prepare("SELECT 1 FROM uploads WHERE bench_digest = ?").bind(bench.digest).first()))
    return problem(409, "This frame-time file was already uploaded with another report.");
  // A maintainer's own run is approved and confirmed as it arrives, so it moves the game's stage without a second
  // tester. Any flags are still stored, so the queue shows what was noticed.
  const confirmedBy = isMaintainer(env, account) ? account.login : null;
  const status = flags.length && !confirmedBy ? "review" : "visible";
  let row: number | null;
  try {
    row = await db
    .prepare(
      "INSERT INTO uploads (github_id, title_id, stage, commit_sha, report, digest, flags, status, created_at, run_id, title_chosen, title_name, stated_stage, bench, bench_digest, verified_by, verified_at, recipe) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(account.github_id, titleId, report.run.stage, report.anyps5.commit ?? "", stored, digest, JSON.stringify(flags), status, nowSeconds(), report.run.id, report.game.titleId ? 0 : 1, titleName, stated, bench ? JSON.stringify(bench.stats) : null, bench?.digest ?? null, confirmedBy, confirmedBy ? nowSeconds() : null, recipe ? JSON.stringify(recipe) : null)
    .first<number>("id");
  } catch (err) {
    // The same run or frame-time file sent twice at once: the second insert hits a unique index.
    if (String(err).includes("UNIQUE")) return problem(409, "This run was already uploaded.");
    throw err;
  }
  if (confirmedBy)
    await db
      .prepare("INSERT INTO moderation_log (action, kind, target, reason, by_login, created_at) VALUES ('verify', 'upload', ?, ?, ?, ?)")
      .bind(String(row), "A maintainer's own upload", confirmedBy, nowSeconds())
      .run();
  if (status === "visible") wait(requestRebuild(env, "upload"));
  return json({ id: row, status, verified: confirmedBy !== null, flags, titleId, stage: stated ?? SITE_STAGE[report.run.stage], fps: bench?.stats.measured.fps ?? null }, 201);
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
  /** Measured from the run's frame-time file; null when it came without one. */
  perf: UploadPerf | null;
  /** The maintainer who checked this run and verified it: it counts toward the game's stage on its own. */
  verifiedBy: string | null;
}

/** The frame-time figures the compatibility pages use; the dialog loads the rest with the report. */
export interface UploadPerf {
  fps: number;
  low1: number;
  p99Ms: number;
  stutters: number;
  /** Measured seconds, warm-up left out. */
  seconds: number;
  gpuBusyPct: number;
  cap: number | null;
  resolutions: string[];
  /** Neither profiled nor built from modified sources: fit to compare with other runs. */
  comparable: boolean;
}

type Row = {
  id: number;
  report: string;
  login: string;
  github_id: number;
  created_at: number;
  title_id: string;
  title_chosen: number;
  title_name: string | null;
  stated_stage: string | null;
  bench: string | null;
  verified_by: string | null;
  recipe: string | null;
};

function perf(bench: string | null): UploadPerf | null {
  if (!bench) return null;
  const s = JSON.parse(bench) as BenchStats;
  const m = s.measured;
  return { fps: m.fps, low1: m.low1, p99Ms: m.frameMs.p99, stutters: m.stutters, seconds: m.seconds, gpuBusyPct: m.gpuBusyPct, cap: m.cap, resolutions: s.resolutions, comparable: s.comparable };
}

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
    perf: perf(row.bench),
    verifiedBy: row.verified_by,
  };
}

const COLUMNS = "u.id, u.report, u.github_id, u.created_at, u.title_id, u.title_chosen, u.title_name, u.stated_stage, u.bench, u.verified_by, u.recipe, a.login";

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
    {
      id: row.id,
      titleId: row.title_id,
      titleChosen: row.title_chosen === 1,
      login: row.login,
      at: new Date(row.created_at * 1000).toISOString(),
      report: JSON.parse(row.report),
      bench: row.bench ? JSON.parse(row.bench) : null,
      recipe: row.recipe ? JSON.parse(row.recipe) : null,
    },
    200,
    { "cache-control": "public, max-age=300" },
  );
}

export { COLUMNS };
