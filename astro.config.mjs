import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { readdirSync } from "node:fs";
import { LOCALES } from "./src/i18n/locales.ts";

// The setup guide moved from /guide into the docs; old links (including each language's) redirect to the new pages.
const guide = "src/content/guide";
const steps = readdirSync(guide).filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, ""));
const languages = readdirSync(guide, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const guideRedirects = Object.fromEntries(
  ["", ...languages.map((l) => `/${l}`)].flatMap((prefix) => [
    [`${prefix}/guide`, `${prefix}/docs/guide`],
    ...steps.map((step) => [`${prefix}/guide/${step}`, `${prefix}/docs/guide/${step}`]),
  ]),
);

export default defineConfig({
  // `||`, not `??`: CI passes an empty string when the SITE_URL variable is not set.
  site: process.env.SITE_URL || "http://localhost:4321",
  integrations: [
    mdx(),
    sitemap({
      // The maintainers' page is noindex; translated pages list each other's language versions.
      filter: (page) => !new URL(page).pathname.startsWith("/moderate"),
      i18n: { defaultLocale: "en", locales: Object.fromEntries(Object.entries(LOCALES).map(([key, l]) => [key, l.lang])) },
    }),
  ],
  trailingSlash: "ignore",
  redirects: guideRedirects,
  devToolbar: { enabled: false },
  // Listen on every interface so other devices on the LAN can open the dev server.
  server: { host: true },
  // OG images fetch game art on a cold cache; render several pages at once.
  build: { concurrency: 8 },
  markdown: {
    // Both themes are emitted as CSS variables; global.css picks one per site theme.
    shikiConfig: { themes: { light: "github-light", dark: "github-dark-dimmed" }, defaultColor: false },
  },
  vite: {
    server: {
      proxy: {
        "/convert/app/libraries": {
          target: "https://boykopovar.github.io/AnyPS5",
          changeOrigin: true,
          rewrite: (path) => path.replace("/convert/app", ""),
        },
      },
    },
  },
});
