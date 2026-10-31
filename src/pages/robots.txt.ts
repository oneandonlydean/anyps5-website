import type { APIContext } from "astro";

/**
 * Everything may be crawled except the bare converter, which /convert shows in a frame. Pages kept out of search results
 * say so with noindex instead, which crawlers must be allowed to read; the demo does it with a header.
 */
export function GET({ site }: APIContext) {
  return new Response(`User-agent: *\nDisallow: /convert/app/\n\nSitemap: ${new URL("/sitemap-index.xml", site).href}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
