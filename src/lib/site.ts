export const REPO_URL = "https://github.com/boykopovar/AnyPS5";
/** Upstream's GitHub Pages: the converter, release manifest, progress data and library map. */
export const UPSTREAM_PAGES = "https://boykopovar.github.io/AnyPS5";
export const DISCORD_URL = "https://discord.gg/x9naWVzC6A";
export const DISCUSSIONS_URL = `${REPO_URL}/discussions/categories/game-bring-up`;

/**
 * Main navigation; labels come from the i18n strings under `nav`. `translated` is where an item leads in other
 * languages when its own page is English only: the docs index is, but the setup guide inside it is translated.
 */
export const NAV: { href: string; key: "compatibility" | "converter" | "docs" | "progress" | "download"; translated?: string }[] = [
  { href: "/compatibility", key: "compatibility" },
  { href: "/convert", key: "converter" },
  { href: "/docs", key: "docs", translated: "/docs/guide" },
  { href: "/progress", key: "progress" },
  { href: "/download", key: "download" },
];

export function newReportUrl(title?: string): string {
  const params = new URLSearchParams({ category: "game-bring-up" });
  if (title) params.set("title", title);
  return `${REPO_URL}/discussions/new?${params}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** When this build ran: one moment for every page, since the module is evaluated once per build. */
export const BUILT_AT = new Date();

/** The Discord logo as one 24×24 SVG path, for the header and the home page's Join button. */
export const DISCORD_ICON =
  "M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18a19.8 19.8 0 0 0 6 3l1.3-2a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4-2 1 1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.6-3.6-13.6ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z";
