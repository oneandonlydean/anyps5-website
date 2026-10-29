/** Renders the PNG icons and app icons from public/favicon.svg. Run after changing the mark: npm run icons. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { root } from "./lib/files";

const svg = await readFile(resolve(root, "public/favicon.svg"));
const out = (name: string) => resolve(root, "public", name);

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
