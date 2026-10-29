import type { APIContext } from "astro";
import { getGames } from "../../lib/data";
import type { Game } from "../../lib/resolve";
import { STAGE_HEX } from "../../lib/stages";
import { reach } from "../../lib/view";

export async function getStaticPaths() {
  return (await getGames()).map((game) => ({ params: { slug: game.slug }, props: { game } }));
}

/** Roughly how wide text is at 11px in the badge font, enough to size its boxes; textLength makes it fit exactly. */
function width(text: string): number {
  let w = 0;
  for (const c of text) w += /[iljtf.,:;|!' ()]/.test(c) ? 3.6 : /[mwMW]/.test(c) ? 9.6 : /[A-Z0-9]/.test(c) ? 7.4 : 6.4;
  return Math.round(w);
}

const escape = (text: string) => text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A flat status badge, "AnyPS5 | Ingame", in the stage's colour, for READMEs, forums and Discord. */
export function GET({ props }: APIContext) {
  const { stage, onMain } = reach((props as { game: Game }).game);
  const label = "AnyPS5";
  const value = stage ? `${stage}${onMain ? "" : " (PR)"}` : "untested";
  const color = STAGE_HEX[stage ?? "Untested"];
  const lw = width(label) + 14;
  const vw = width(value) + 14;
  const total = lw + vw;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escape(`${label}: ${value}`)}">
  <title>${escape(`${label}: ${value}`)}</title>
  <clipPath id="r"><rect width="${total}" height="20" rx="4"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#1c2333"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
  </g>
  <g font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="${lw / 2}" y="14" fill="#e9edf5" textLength="${lw - 14}">${label}</text>
    <text x="${lw + vw / 2}" y="14" fill="#06080d" font-weight="bold" textLength="${vw - 14}">${escape(value)}</text>
  </g>
</svg>
`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
}
