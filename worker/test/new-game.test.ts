import { env as base } from "cloudflare:workers";
import { expect, it } from "vitest";
import noTitle from "../../tests/fixtures/run-reports/missing-metadata-gpu.json";
import worker from "../src/index";
import { sha256 } from "../src/site/http";
import { ctx } from "./helpers";

// Its own file, so the Worker reads this list of known games rather than one cached by another test.
const env = {
  ...base,
  ASSETS: { fetch: async () => Response.json({ implemented: [], untranslated: [], titleIds: ["PPSA12345"] }) } as unknown as Fetcher,
};
const SITE = "https://worker.test";
const now = () => Math.floor(Date.now() / 1000);
const report = () => ({
  ...structuredClone(noTitle),
  generated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  run: { ...noTitle.run, id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("") },
});

async function signIn(login: string, id: number): Promise<string> {
  const token = `session-${login}`;
  await env.SITE_DB!.batch([
    env.SITE_DB!.prepare("INSERT OR REPLACE INTO accounts (github_id, login, avatar, created_at) VALUES (?, ?, NULL, ?)").bind(id, login, now()),
    env.SITE_DB!.prepare("INSERT INTO sessions (id_hash, github_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), id, now() + 3600),
  ]);
  return `session=${token}`;
}

const post = (path: string, body: unknown, cookie: string) =>
  worker.fetch!(
    new Request(`${SITE}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", cookie, origin: SITE } }) as any,
    env,
    ctx,
  );

it("takes a game that isn't on the list yet, with its name, and holds it for a maintainer", async () => {
  const cookie = await signIn("tester", 42);
  const unnamed = await post("/api/reports?titleId=PPSA99901", report(), cookie);
  expect(unnamed.status).toBe(400);
  expect(await unnamed.json()).toMatchObject({ needsName: true });

  const named = await post(`/api/reports?titleId=ppsa99901&name=${encodeURIComponent("  Test Homebrew ")}`, report(), cookie);
  expect(named.status).toBe(201);
  const body = await named.json<{ status: string; titleId: string; flags: string[] }>();
  expect(body).toMatchObject({ status: "review", titleId: "PPSA99901" });
  expect(body.flags.at(-1)).toContain("Test Homebrew (PPSA99901)");
  const row = await env.SITE_DB!.prepare("SELECT title_name, status FROM uploads WHERE title_id = 'PPSA99901'").first();
  expect(row).toEqual({ title_name: "Test Homebrew", status: "review" });

  // A game on the list needs no name and no review.
  const listed = await post("/api/reports?titleId=PPSA12345&name=ignored", report(), cookie);
  expect(await listed.json()).toMatchObject({ status: "visible", titleId: "PPSA12345" });
  expect(await env.SITE_DB!.prepare("SELECT title_name FROM uploads WHERE title_id = 'PPSA12345'").first("title_name")).toBeNull();
});
