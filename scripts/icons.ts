/**
 * Writes public/favicon.svg and the PNG and app icons from the logo mark (src/assets/logo/mark.svg). Run after changing
 * the mark: npm run icons.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { root } from "./lib/files";

const out = (name: string) => resolve(root, "public", name);
const mark = await readFile(resolve(root, "src/assets/logo/mark.svg"), "utf8");
const [, , , width, height] = mark.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)!.map(Number);
const shape = mark.replace(/^<svg[^>]*>|<\/svg>\s*$/g, "").trim();
const side = Math.max(width, height);
const box = (pad: number) => `${-(side - width) / 2 - pad} ${-(side - height) / 2 - pad} ${side + 2 * pad} ${side + 2 * pad}`;

// The browser tab icon is the bare mark, dark on light browser themes and light on dark ones.
await writeFile(
  out("favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(side * 0.04)}">
<style>g{fill:#0c111d}@media (prefers-color-scheme:dark){g{fill:#e9edf5}}</style>
${shape}
</svg>
`,
);

// The PNGs and app icons can't follow a theme, so they put the light mark on the site's dark tile.
const pad = side * 0.22;
const full = side + 2 * pad;
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(pad)}">
<rect x="${-(side - width) / 2 - pad}" y="${-(side - height) / 2 - pad}" width="${full}" height="${full}" rx="${full / 4}" fill="#06080d"/>
<g fill="#e9edf5">${shape}</g>
</svg>`);

await sharp(svg, { density: 384 }).resize(32, 32).png().toFile(out("favicon-32.png"));
for (const size of [180, 192, 512]) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(out(size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`));
}
// Maskable icons are cropped to a circle by some launchers, so the mark sits inside the central safe zone.
const inner = await sharp(svg, { density: 384 }).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#06080d" } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(out("icon-maskable-512.png"));

await writeFile(
  out("manifest.webmanifest"),
  JSON.stringify(
    {
      name: "AnyPS5",
      short_name: "AnyPS5",
      description: "Native Linux and Windows ports of PS5 games: converter, setup guide and compatibility.",
      start_url: "/",
      display: "standalone",
      background_color: "#06080d",
      theme_color: "#06080d",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log("icons written to public/");
