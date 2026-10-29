/** Small helpers for the site's JSON endpoints. */

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export const problem = (status: number, message: string) => json({ error: message }, status);

/** State-changing requests must come from the site's own pages; a browser always sends Origin on a cross-site POST. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin !== null && origin === new URL(req.url).origin;
}

export function cookie(req: Request, name: string): string | undefined {
  return req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;

export function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
