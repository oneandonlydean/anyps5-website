import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import sample from "../../tests/fixtures/run-reports/stop-unsupported-shader.json";
import noTitle from "../../tests/fixtures/run-reports/missing-metadata-gpu.json";
import presents from "../../tests/fixtures/run-reports/stop-none.json";
import worker from "../src/index";
import { sha256 } from "../src/site/http";
import { gzip, makeBench, steady } from "../../tests/fixtures/bench";
import { ctx, json, mockFetch } from "./helpers";

const SITE = "https://worker.test";
const now = () => Math.floor(Date.now() / 1000);
// Each upload is a different run: a new run id, dated now.
const runId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const fresh = () => {
  const r = structuredClone(sample);
  r.generated = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  r.run.id = runId();
  return r;
};

async function signIn(login: string, id: number): Promise<string> {
  const token = `session-${login}`;
  await env.SITE_DB!.batch([
    env.SITE_DB!.prepare("INSERT OR REPLACE INTO accounts (github_id, login, avatar, created_at) VALUES (?, ?, NULL, ?)").bind(id, login, now()),
    env.SITE_DB!.prepare("INSERT INTO sessions (id_hash, github_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), id, now() + 3600),
  ]);
  return `session=${token}`;
}

const call = (path: string, init: RequestInit & { cookie?: string; origin?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.origin !== null && init.method === "POST") headers.set("origin", init.origin ?? SITE);
  return worker.fetch!(new Request(`${SITE}${path}`, { ...init, headers }) as any, env, ctx);
};
const post = (path: string, body: unknown, cookie?: string, origin?: string | null) =>
  call(path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), cookie, origin, headers: { "content-type": "application/json" } });
/** A report and its frame-time file, as the upload form sends them. */
const postWithBench = (path: string, report: unknown, bench: Uint8Array | null, cookie?: string) => {
  const form = new FormData();
  form.set("report", new Blob([JSON.stringify(report)], { type: "application/json" }), "anyps5-report.json");
  if (bench) form.set("bench", new Blob([bench as Uint8Array<ArrayBuffer>]), "aps5-bench-40f2a9c3d1b7-1234.json.gz");
  return call(path, { method: "POST", body: form, cookie });
};
// The presents fixture ran 303 s past its first frame and presented 12580 frames: a warm-up and nine 40 fps intervals fit.
const fitting = (gpu = "AMD Radeon RX 6800 (RADV NAVI21)") => gzip(makeBench(10, (n) => (n === 0 ? steady(20) : steady(40)), { gpu }));
const freshPresents = () => ({ ...structuredClone(presents), generated: new Date().toISOString().replace(/\.\d+Z$/, "Z"), run: { ...presents.run, id: runId() } });

it("signs in with GitHub and keeps only a hashed session", async () => {
  const start = await call("/auth/github?return=/compatibility/hades-ii");
  expect(start.status).toBe(302);
  const location = new URL(start.headers.get("location")!);
  expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
  const state = location.searchParams.get("state")!;

  mockFetch({
    "POST https://github.com/login/oauth/access_token": () => json({ access_token: "gh-user-token" }),
    "GET https://api.github.com/user": () => json({ id: 42, login: "Tester", avatar_url: "https://avatars.test/42" }),
  });
  const done = await call(`/auth/github/callback?code=c&state=${state}`, { cookie: `login_state=${state}` });
  expect(done.status).toBe(302);
  expect(done.headers.get("location")).toBe("/compatibility/hades-ii");
  const session = done.headers.getSetCookie().find((c) => c.startsWith("session="))!.split(";")[0]!;

  const me = await (await call("/api/me", { cookie: session })).json();
  expect(me).toMatchObject({ signedIn: true, login: "Tester", maintainer: false });
  const stored = await env.SITE_DB!.prepare("SELECT id_hash FROM sessions").first<string>("id_hash");
  expect(stored).toBe(await sha256(session.slice("session=".length)));
});

it("refuses a callback whose state doesn't match the cookie, and only returns to this site", async () => {
  expect((await call("/auth/github/callback?code=c&state=x", { cookie: "login_state=y" })).status).toBe(400);
  const start = await call("/auth/github?return=//evil.example");
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const row = await env.SITE_DB!.prepare("SELECT return_to FROM login_state WHERE state = ?").bind(state).first<string>("return_to");
  expect(row).toBe("/report");
});

it("takes a valid report once, from a signed-in account on this site", async () => {
  const cookie = await signIn("tester", 42);
  const report = fresh();
  const res = await post("/api/reports", report, cookie);
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ status: "visible", titleId: "PPSA12345", stage: "First draw", flags: [] });
  expect((await post("/api/reports", report, cookie)).status).toBe(409);
  expect((await post("/api/reports", report)).status).toBe(401);
  expect((await post("/api/reports", fresh(), cookie, "https://evil.example")).status).toBe(403);
  // The same run, re-saved with a different date, is still the same run.
  expect((await post("/api/reports", { ...report, generated: new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/, "Z") }, cookie)).status).toBe(409);
});

it("rejects files that aren't reports, or that contradict themselves", async () => {
  const cookie = await signIn("tester", 42);
  expect((await post("/api/reports", "not json", cookie)).status).toBe(400);
  const wrong = await post("/api/reports", { ...fresh(), extra: true }, cookie);
  expect(wrong.status).toBe(400);
  expect((await wrong.json<{ error: string }>()).error).toBe("This isn't a valid AnyPS5 run report.");
  const contradictory = fresh();
  contradictory.run.milestones.firstDraw = 0.5;
  expect((await post("/api/reports", contradictory, cookie)).status).toBe(400);
  expect((await post("/api/reports", "x".repeat(70_000), cookie)).status).toBe(413);
});

it("holds flagged reports for review and keeps them out of the export", async () => {
  const cookie = await signIn("tester", 42);
  const modified = fresh();
  modified.anyps5.modified = true;
  const res = await post("/api/reports", modified, cookie);
  expect(await res.json()).toMatchObject({ status: "review", flags: ["Built from modified AnyPS5 sources."] });
  const exported = await (await call("/api/export")).json<{ uploads: unknown[] }>();
  expect(exported.uploads).toHaveLength(0);
});

it("serves a visible upload's whole report by id, and nothing that is flagged, hidden or blocked", async () => {
  const tester = await signIn("tester", 42);
  const mod = await signIn("MOD1", 7);
  const report = fresh();
  const { id } = await (await post("/api/reports", report, tester)).json<{ id: number }>();
  const res = await call(`/api/reports/${id}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id, login: "tester", titleId: "PPSA12345", report: { run: { id: report.run.id }, system: { gpu: { name: report.system.gpu!.name } } } });
  expect((await call("/api/reports/999999")).status).toBe(404);
  expect((await call("/api/reports/abc")).status).not.toBe(200);

  const flagged = fresh();
  flagged.anyps5.modified = true;
  const held = await (await post("/api/reports", flagged, tester)).json<{ id: number }>();
  expect((await call(`/api/reports/${held.id}`)).status).toBe(404);

  await post("/api/mod/action", { action: "hide", kind: "upload", target: String(id) }, mod);
  expect((await call(`/api/reports/${id}`)).status).toBe(404);
});

it("keeps a run recipe sent with its report and serves it with the report, secrets left out", async () => {
  const tester = await signIn("tester", 42);
  const report = fresh();
  const recipe = (id: string) => ({
    format: "anyps5-recipe",
    version: 1,
    generated: report.generated,
    run: { id },
    anyps5: { commit: report.anyps5.commit },
    argv: ["anyps5", "--game", "My Game/eboot.elf", "--token=abc"],
    environment: { ANYPS5_VSYNC: "0", ANYPS5_API_KEY: "secret" },
    configFiles: ["pad.toml"],
  });
  const send = (r: unknown, rec: unknown) => {
    const form = new FormData();
    form.set("report", new Blob([JSON.stringify(r)], { type: "application/json" }), "anyps5-report.json");
    form.set("recipe", new Blob([typeof rec === "string" ? rec : JSON.stringify(rec)], { type: "application/json" }), "anyps5-recipe.json");
    return call("/api/reports", { method: "POST", body: form, cookie: tester });
  };

  const other = await send(report, recipe(runId()));
  expect(other.status).toBe(400);
  expect(await other.json()).toMatchObject({ error: "This run recipe isn't from this run.", badRecipe: true });
  expect((await send(report, "not json")).status).toBe(400);

  const ok = await send(report, recipe(report.run.id));
  expect(ok.status).toBe(201);
  const { id } = await ok.json<{ id: number }>();
  const detail = await (await call(`/api/reports/${id}`)).json<{ recipe: { argv: string[]; environment: Record<string, string> } }>();
  expect(detail.recipe.argv).toEqual(["anyps5", "--game", "My Game/eboot.elf", "--token=[redacted]"]);
  expect(detail.recipe.environment).toEqual({ ANYPS5_VSYNC: "0" });
  // A report sent without one has none.
  const plain = await (await post("/api/reports", fresh(), tester)).json<{ id: number }>();
  expect((await (await call(`/api/reports/${plain.id}`)).json<{ recipe: unknown }>()).recipe).toBeNull();
});

it("lets maintainers approve, hide and block, logs it, and keeps others out", async () => {
  const tester = await signIn("tester", 42);
  const mod = await signIn("MOD1", 7);
  const modified = fresh();
  modified.anyps5.modified = true;
  const { id } = await (await post("/api/reports", modified, tester)).json<{ id: number }>();

  expect((await post("/api/mod/action", { action: "approve", kind: "upload", target: String(id) }, tester)).status).toBe(403);
  expect((await call("/api/mod/queue", { cookie: tester })).status).toBe(403);
  const queue = await (await call("/api/mod/queue", { cookie: mod })).json<{ review: { id: number; flags: string[] }[] }>();
  expect(queue.review.map((r) => r.id)).toEqual([id]);

  expect((await post("/api/mod/action", { action: "approve", kind: "upload", target: String(id) }, mod)).status).toBe(200);
  expect((await post("/api/mod/action", { action: "hide", kind: "screenshot", target: "abc123", reason: "duplicate" }, mod)).status).toBe(200);
  expect((await post("/api/mod/action", { action: "hide", kind: "art", target: "PPSA21564:cover" }, mod)).status).toBe(200);
  let exported = await (await call("/api/export")).json<{ uploads: { id: number; login: string }[]; hidden: { screenshots: string[]; art: string[] } }>();
  expect(exported.uploads.map((u) => [u.id, u.login])).toEqual([[id, "tester"]]);
  expect(exported.hidden).toEqual({ screenshots: ["abc123"], art: ["PPSA21564:cover"] });

  expect((await post("/api/mod/action", { action: "block", kind: "account", target: "tester" }, mod)).status).toBe(200);
  exported = await (await call("/api/export")).json();
  expect(exported.uploads).toHaveLength(0);
  expect((await post("/api/reports", fresh(), tester)).status).toBe(403);

  expect((await post("/api/mod/action", { action: "explode", kind: "upload", target: "1" }, mod)).status).toBe(400);
  expect((await post("/api/mod/action", { action: "hide", kind: "art", target: "../etc" }, mod)).status).toBe(400);
  const log = await env.SITE_DB!.prepare("SELECT action, kind, by_login FROM moderation_log ORDER BY id").all();
  expect(log.results.map((r) => `${r.action} ${r.kind} ${r.by_login}`)).toEqual(["approve upload MOD1", "hide screenshot MOD1", "hide art MOD1", "block account MOD1"]);
});

it("asks the site repository to rebuild after an upload, at most once every two minutes", async () => {
  const cookie = await signIn("tester", 42);
  const calls = mockFetch({ "POST https://api.github.com/repos/acme/site/dispatches": () => new Response(null, { status: 204 }) });
  const e = { ...env, SITE_DISPATCH_TOKEN: "dispatch-token", SITE_REPO: "acme/site" };
  const send = (_generated: string) =>
    worker.fetch!(
      new Request(`${SITE}/api/reports`, { method: "POST", body: JSON.stringify(fresh()), headers: { cookie, origin: SITE } }) as any,
      e as any,
      { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException() {}, props: {} } as unknown as ExecutionContext,
    );
  expect((await send(new Date().toISOString())).status).toBe(201);
  await new Promise((r) => setTimeout(r, 20));
  expect((await send(new Date(Date.now() - 5000).toISOString())).status).toBe(201);
  await new Promise((r) => setTimeout(r, 20));
  expect(calls.filter((c) => c.url.endsWith("/dispatches"))).toHaveLength(1);
  expect(JSON.parse(calls[0]!.body)).toMatchObject({ event_type: "site-data-changed" });
});

it("asks the site repository to check upstream every SITE_REFRESH_MINUTES, and sends held-back rebuilds, without the bot", async () => {
  const calls = mockFetch({ "POST https://api.github.com/repos/acme/site/dispatches": () => new Response(null, { status: 204 }) });
  const e = { ...env, SITE_DISPATCH_TOKEN: "dispatch-token", SITE_REPO: "acme/site", SITE_REFRESH_MINUTES: "30", TOKEN_KEY: undefined };
  const tick = (iso: string) => worker.scheduled!({ scheduledTime: Date.parse(iso), cron: "* * * * *", noRetry() {} } as ScheduledController, e as any);
  const sent = () => calls.filter((c) => c.url.endsWith("/dispatches")).map((c) => JSON.parse(c.body).event_type);

  await tick("2026-11-01T10:30:00Z");
  await tick("2026-11-01T10:31:00Z");
  expect(sent()).toEqual(["scheduled-check"]);

  // An upload held back by the two-minute quiet period goes out on a later minute.
  await env.SITE_DB!.prepare("INSERT INTO site_kv (key, value) VALUES ('rebuild_at', '0'), ('rebuild_pending', 'upload') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  await tick("2026-11-01T10:32:00Z");
  expect(sent()).toEqual(["scheduled-check", "site-data-changed"]);
});

it("asks which game a report without a title ID was, and accepts the uploader's choice", async () => {
  const cookie = await signIn("tester", 42);
  const report = { ...structuredClone(noTitle), generated: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
  const first = await post("/api/reports", report, cookie);
  expect(first.status).toBe(400);
  expect(await first.json()).toMatchObject({ needsGame: true });
  expect((await post("/api/reports?titleId=not-an-id", report, cookie)).status).toBe(400);
  const chosen = await post("/api/reports?titleId=PPSA12345", report, cookie);
  expect(chosen.status).toBe(201);
  // This Worker has no compatibility list to check the choice against, so a maintainer checks it before it shows.
  expect(await chosen.json()).toMatchObject({ titleId: "PPSA12345", stage: null, status: "review" });
  const exported = await (await call("/api/export")).json<{ uploads: unknown[] }>();
  expect(exported.uploads).toEqual([]);
});

it("takes how far the tester got past frames on screen, only for a run that presented frames", async () => {
  const cookie = await signIn("tester", 42);
  const run = (base: typeof presents | typeof sample) => ({ ...structuredClone(base), generated: new Date().toISOString().replace(/\.\d+Z$/, "Z"), run: { ...base.run, id: runId() } });
  expect((await post("/api/reports?reached=ingame", run(sample), cookie)).status).toBe(400);
  expect((await post("/api/reports?reached=boss-fight", run(presents), cookie)).status).toBe(400);
  const ok = await postWithBench("/api/reports?reached=ingame", run(presents), await fitting(), cookie);
  expect(ok.status).toBe(201);
  const { id } = await ok.json<{ id: number }>();
  const exported = await (await call("/api/export")).json<{ uploads: { id: number; stage: string | null; stated: string | null }[] }>();
  expect(exported.uploads.find((u) => u.id === id)).toMatchObject({ stage: "Ingame", stated: "Ingame" });
});

it("needs the frame-time file of a run that presented frames, and measures the frame rate from it", async () => {
  const cookie = await signIn("tester", 42);
  const needs = await post("/api/reports", freshPresents(), cookie);
  expect(needs.status).toBe(400);
  expect(await needs.json()).toMatchObject({ needsBench: true });
  // A run that never presented needs none, in either form.
  expect((await postWithBench("/api/reports", fresh(), null, cookie)).status).toBe(201);

  const ok = await postWithBench("/api/reports", freshPresents(), await fitting(), cookie);
  expect(ok.status).toBe(201);
  // The report says 41.5; the frame times say 40.
  const { id, fps } = await ok.json<{ id: number; fps: number }>();
  expect(fps).toBe(40);
  const exported = await (await call("/api/export")).json<{ uploads: { id: number; perf: unknown }[] }>();
  expect(exported.uploads.find((u) => u.id === id)?.perf).toMatchObject({ fps: 40, low1: 40, stutters: 0, comparable: true, resolutions: ["1920x1080"] });
  const detail = await (await call(`/api/reports/${id}`)).json<{ bench: { warmup: { fps: number }; intervals: unknown[] } }>();
  expect(detail.bench.warmup.fps).toBe(20);
  expect(detail.bench.intervals).toHaveLength(10);
  const stored = await env.SITE_DB!.prepare("SELECT bench FROM uploads WHERE id = ?").bind(id).first<string>("bench");
  expect(stored).not.toContain("frame_us");

  // The same file can't be attached to another report.
  expect((await postWithBench("/api/reports", freshPresents(), await fitting(), cookie)).status).toBe(409);
});

it("refuses a frame-time file from another run, and flags a GPU named differently", async () => {
  const cookie = await signIn("tester", 42);
  const other = await postWithBench("/api/reports", freshPresents(), await gzip(makeBench(10, () => steady(40), { title_id: "PPSA99999" })), cookie);
  expect(other.status).toBe(400);
  expect(await other.json()).toMatchObject({ error: "This frame-time file isn't from this run.", needsBench: true });
  const broken = await postWithBench("/api/reports", freshPresents(), new TextEncoder().encode("{}"), cookie);
  expect(await broken.json()).toMatchObject({ error: "This isn't a valid AnyPS5 frame-time file." });
  const flagged = await postWithBench("/api/reports", freshPresents(), await fitting("NVIDIA GeForce RTX 4080"), cookie);
  expect(await flagged.json()).toMatchObject({ status: "review" });
});

it("lets a maintainer verify one upload so it counts alone, and take it back", async () => {
  const tester = await signIn("tester", 42);
  const maintainer = await signIn("maint", 7);
  const flagged = fresh();
  flagged.anyps5.modified = true;
  const { id } = await (await post("/api/reports", flagged, tester)).json<{ id: number }>();
  const act = (action: string, cookie: string) => post("/api/mod/action", { action, kind: "upload", target: String(id) }, cookie);
  expect((await act("verify", tester)).status).toBe(403);
  expect((await act("verify", maintainer)).status).toBe(200);
  // Verifying approves too, and the export says who verified it.
  const exported = await (await call("/api/export")).json<{ uploads: { id: number; verifiedBy: string | null }[] }>();
  expect(exported.uploads.find((u) => u.id === id)?.verifiedBy).toBe("maint");
  expect((await act("verify", maintainer)).status).toBe(404);
  const queue = await (await call("/api/mod/queue", { cookie: maintainer })).json<{ log: { action: string }[] }>();
  expect(queue.log[0]?.action).toBe("verify");
  expect((await act("unverify", maintainer)).status).toBe(200);
  const after = await (await call("/api/export")).json<{ uploads: { id: number; verifiedBy: string | null }[] }>();
  expect(after.uploads.find((u) => u.id === id)?.verifiedBy).toBeNull();
});

it("approves and confirms a maintainer's own upload as it arrives, even when flagged", async () => {
  const maintainer = await signIn("maint", 7);
  const flagged = fresh();
  flagged.anyps5.modified = true;
  const res = await post("/api/reports", flagged, maintainer);
  expect(res.status).toBe(201);
  const { id, status, verified, flags } = await res.json<{ id: number; status: string; verified: boolean; flags: string[] }>();
  expect(status).toBe("visible");
  expect(verified).toBe(true);
  // What was noticed is still kept for the record.
  expect(flags.length).toBeGreaterThan(0);
  const exported = await (await call("/api/export")).json<{ uploads: { id: number; verifiedBy: string | null }[] }>();
  expect(exported.uploads.find((u) => u.id === id)?.verifiedBy).toBe("maint");
  const queue = await (await call("/api/mod/queue", { cookie: maintainer })).json<{ review: { id: number }[]; log: { action: string; target: string; by_login: string }[] }>();
  expect(queue.review.some((u) => u.id === id)).toBe(false);
  expect(queue.log[0]).toMatchObject({ action: "verify", target: String(id), by_login: "maint" });

  // Anyone else's flagged upload still waits for review, unconfirmed.
  const tester = await signIn("tester", 42);
  const other = fresh();
  other.anyps5.modified = true;
  const theirs = await (await post("/api/reports", other, tester)).json<{ status: string; verified: boolean }>();
  expect(theirs).toMatchObject({ status: "review", verified: false });
});

it("never returns sign-in anywhere but this site, even with tabs or newlines in the path", async () => {
  for (const sneaky of ["/%09/evil.example", "/%0a/evil.example", "//evil.example", "/\\evil.example", "https://evil.example/"]) {
    const start = await call(`/auth/github?return=${sneaky}`);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const row = await env.SITE_DB!.prepare("SELECT return_to FROM login_state WHERE state = ?").bind(state).first<string>("return_to");
    expect(row, sneaky).toBe("/report");
  }
  const ok = await call(`/auth/github?return=${encodeURIComponent("/compatibility/hades-ii?x=1#uploads")}`);
  const state = new URL(ok.headers.get("location")!).searchParams.get("state")!;
  expect(await env.SITE_DB!.prepare("SELECT return_to FROM login_state WHERE state = ?").bind(state).first<string>("return_to")).toBe("/compatibility/hades-ii?x=1#uploads");
});

it("gives maintainer rights by account id, not login, and takes them from a blocked account", async () => {
  const impostor = await signIn("MOD1", 999);
  expect((await call("/api/mod/queue", { cookie: impostor })).status).toBe(403);
  const mod = await signIn("someone-renamed", 7);
  expect((await call("/api/mod/queue", { cookie: mod })).status).toBe(200);
  await env.SITE_DB!.prepare("UPDATE accounts SET blocked = 1 WHERE github_id = 7").run();
  expect((await call("/api/mod/queue", { cookie: mod })).status).toBe(403);
});

it("proxies only the converter's archives, as downloads", async () => {
  mockFetch({ "GET https://boykopovar.github.io/AnyPS5/libraries/": () => new Response("<script>alert(1)</script>", { headers: { "content-type": "text/html" } }) });
  expect((await call("/convert/app/libraries/page.html")).status).toBe(404);
  expect((await call("/convert/app/libraries/x.zip", { method: "POST", origin: null })).status).toBe(405);
  const zip = await call("/convert/app/libraries/linux-abc.zip");
  expect(zip.headers.get("content-type")).toBe("application/octet-stream");
  expect(zip.headers.get("x-content-type-options")).toBe("nosniff");
});

it("lists the site database's applied migrations, for a deploy to check against", async () => {
  const res = await call("/api/schema");
  expect(res.status).toBe(200);
  const { migrations } = await res.json<{ migrations: string[] }>();
  expect(migrations[0]).toMatch(/^0001_/);
  expect(migrations).toContain("0006_verified.sql");
});
