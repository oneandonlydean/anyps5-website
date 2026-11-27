import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker, { rekey, type RekeyEnv } from "../rekey/index";
import { decrypt, encrypt, importKey } from "../src/bot/crypto";

const newKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

async function member(id: string, key: string, access = `access-${id}`, refresh = `refresh-${id}`) {
  const k = await importKey(key);
  await env.DB.prepare("INSERT INTO users (discord_id, access_token_enc, refresh_token_enc, token_expires_at, created_at) VALUES (?, ?, ?, 0, 0)")
    .bind(id, await encrypt(k, access), await encrypt(k, refresh))
    .run();
}

async function tokens(id: string, key: string) {
  const k = await importKey(key);
  const row = await env.DB.prepare("SELECT access_token_enc, refresh_token_enc FROM users WHERE discord_id = ?").bind(id).first<Record<string, string>>();
  return [await decrypt(k, row!.access_token_enc!), await decrypt(k, row!.refresh_token_enc!)];
}

describe("the cutover's token re-encryption", () => {
  it("moves every member's tokens to the new key, and a second run changes nothing", async () => {
    const old = newKey();
    const fresh = newKey();
    await member("1", old);
    await member("2", old);
    await member("3", newKey()); // neither key: left alone
    const rekeyEnv: RekeyEnv = { DB: env.DB, TOKEN_KEY: old, NEW_TOKEN_KEY: fresh, REKEY_PASSWORD: "pw" };

    expect(await rekey(rekeyEnv, true)).toEqual({ members: 3, rekeyed: 2, already: 0, unreadable: ["3"], dryRun: true });
    expect(await tokens("1", old)).toEqual(["access-1", "refresh-1"]);

    expect(await rekey(rekeyEnv, false)).toEqual({ members: 3, rekeyed: 2, already: 0, unreadable: ["3"], dryRun: false });
    expect(await tokens("1", fresh)).toEqual(["access-1", "refresh-1"]);
    expect(await tokens("2", fresh)).toEqual(["access-2", "refresh-2"]);
    await expect(tokens("1", old)).rejects.toThrow();

    expect(await rekey(rekeyEnv, false)).toMatchObject({ rekeyed: 0, already: 2, unreadable: ["3"] });
  });

  it("only runs for a POST to /rekey with the password", async () => {
    const e: RekeyEnv = { DB: env.DB, TOKEN_KEY: newKey(), NEW_TOKEN_KEY: newKey(), REKEY_PASSWORD: "right" };
    const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://anyps5.emdd.me${path}`, init), e);
    expect((await call("/interactions", { method: "POST" })).status).toBe(410);
    expect((await call("/rekey", { method: "POST", headers: { authorization: "Bearer wrong" } })).status).toBe(403);
    expect((await call("/rekey", { method: "POST" })).status).toBe(403);
    const ok = await call("/rekey?dry-run", { method: "POST", headers: { authorization: "Bearer right" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ members: 0, dryRun: true });
  });
});
