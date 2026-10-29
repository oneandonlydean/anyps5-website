/**
 * Serves the built site from Cloudflare's static assets. The only request that reaches this code is the converter's
 * system library download: those archives (~100 MB each) exceed the 25 MiB asset limit, so they stream from the
 * upstream Pages site instead, as the dev server's proxy does.
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const UPSTREAM = "https://boykopovar.github.io/AnyPS5";
const LIBRARIES = "/convert/app/libraries/";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(LIBRARIES)) return env.ASSETS.fetch(request);
    const range = request.headers.get("range");
    const upstream = await fetch(`${UPSTREAM}/libraries/${url.pathname.slice(LIBRARIES.length)}${url.search}`, {
      method: request.method,
      headers: range ? { range } : {},
      // Archives are named by hash, so they are cached for a day; errors are not, so a brief upstream outage clears.
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 86400, "300-599": 0 } },
    } as RequestInit);
    const headers = new Headers(upstream.headers);
    headers.set("cache-control", upstream.ok ? "public, max-age=86400" : "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
