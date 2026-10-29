import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.SITE_URL ?? "http://localhost:4321",
  integrations: [mdx(), sitemap()],
  trailingSlash: "ignore",
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
