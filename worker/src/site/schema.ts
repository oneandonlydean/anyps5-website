import type { Env } from "../bot/env";
import { json } from "./http";

/**
 * The site database's applied migrations, as wrangler records them. A deploy whose token can't reach the database asks
 * the running Worker instead, so it never ships code ahead of the schema (scripts/deploy-demo.sh).
 */
export async function schema(_req: Request, env: Env): Promise<Response> {
  const { results } = await env.SITE_DB!.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
  return json({ migrations: results.map((r) => r.name) });
}
