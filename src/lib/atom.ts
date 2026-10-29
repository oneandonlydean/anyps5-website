/** One entry in an Atom feed; `url` may be relative to the site. */
export interface AtomEntry {
  id: string;
  title: string;
  url: string;
  date: string;
  summary: string;
  category?: string;
}

const escape = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const iso = (date: string) => new Date(date.length === 10 ? `${date}T00:00:00Z` : date).toISOString();

/** An Atom feed document, newest entries first. */
export function atomFeed(options: { site: URL | undefined; path: string; page: string; title: string; subtitle: string; entries: AtomEntry[] }): Response {
  const base = options.site ?? new URL("http://localhost:4321");
  const absolute = (url: string) => new URL(url, base).href;
  const entries = options.entries
    .map(
      (e) => `  <entry>
    <id>${escape(absolute(e.id))}</id>
    <title>${escape(e.title)}</title>
    <link href="${escape(absolute(e.url))}"/>
    <updated>${iso(e.date)}</updated>${e.category ? `\n    <category term="${escape(e.category)}"/>` : ""}
    <summary>${escape(e.summary)}</summary>
  </entry>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escape(absolute(options.page))}</id>
  <title>${escape(options.title)}</title>
  <subtitle>${escape(options.subtitle)}</subtitle>
  <link rel="self" href="${escape(absolute(options.path))}"/>
  <link href="${escape(absolute(options.page))}"/>
  <updated>${options.entries[0] ? iso(options.entries[0].date) : new Date(0).toISOString()}</updated>
${entries}
</feed>
`;
  return new Response(xml, { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
}
