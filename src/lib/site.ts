export const REPO_URL = "https://github.com/boykopovar/AnyPS5";
/** Upstream's GitHub Pages: the converter, release manifest, progress data and library map. */
export const UPSTREAM_PAGES = "https://boykopovar.github.io/AnyPS5";
export const DISCORD_URL = "https://discord.gg/BHFztBPUe";
export const DISCUSSIONS_URL = `${REPO_URL}/discussions/categories/game-bring-up`;
export const SITE_REPO_URL = "https://github.com/oneandonlydean/anyps5-website";

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
