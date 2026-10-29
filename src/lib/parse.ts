import type { BuildKind, Platform, Report } from "./schema";
import { NOT_CONVERTING, type StageOrNone } from "./stages";

const REPO_REF = /github\.com\/boykopovar\/AnyPS5\/(?:issues|pull)\/(\d+)/gi;
const HASH_REF = /(?<![\w/&])#(\d{2,6})\b/g;

export function titleIds(text: string): string[] {
  return unique([...text.toUpperCase().matchAll(/\b(PPSA|CUSA)[-_ ]?(\d{5})\b/g)].map((m) => m[1] + m[2]));
}

export function issueRefs(text: string): number[] {
  const refs = [...text.matchAll(REPO_REF), ...text.matchAll(HASH_REF)].map((m) => Number(m[1]));
  return unique(refs);
}

/** Splits an issue-form body into `{ "furthest point": "Menu", ... }` keyed by lower-case heading. */
export function formSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = body.split(/^#{2,4}[ \t]+(.+?)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const value = parts[i + 1].trim();
    if (value && value !== "_No response_") sections[normalizeKey(parts[i])] = value;
  }
  return sections;
}

/** Reads `**Furthest point:** Menu` or `- Furthest Point: Menu` style lines. */
export function inlineField(body: string, names: string[]): string | null {
  for (const line of body.split("\n")) {
    const match = line.match(/^[\s>*\-+]*\**([A-Za-z][A-Za-z /]{1,30}?)\**\s*:\s*\**\s*(.+)$/);
    if (match && names.includes(normalizeKey(match[1]))) return match[2].replace(/\*+/g, "").trim() || null;
  }
  return null;
}

/** Reads the answer to a dropdown or checkbox field: the checked boxes if it is a list, else its first line. */
export function answer(value: string): string | null {
  const boxes = [...value.matchAll(/^\s*[-*] \[([ xX])\]\s*(.+)$/gm)];
  if (boxes.length) return boxes.find((b) => b[1] !== " ")?.[2].trim() ?? null;
  return firstLine(value) || null;
}

export function stageFromFurthest(furthest: string, blocker = ""): StageOrNone | null {
  const text = furthest.toLowerCase().replace(/[*_`]/g, "").trim();
  if (/does ?n[o']?t convert|fails? to convert/.test(text)) return NOT_CONVERTING;
  if (/^(not|no)\b/.test(text)) return null;
  if (/^playable\b/.test(text)) return "Playable";
  if (/in[ -]?game|gameplay/.test(text)) return "Ingame";
  if (/menu|title screen/.test(text)) return "Menus";
  if (/logo|loading|intro|splash|video|movie|cutscene|cinematic|scene|\bpresents?\b/.test(text)) return "Presents";
  if (/not launched/.test(text)) return "Converts";
  if (/first frame|black (screen|frame)|boots?\b|start-?up/.test(text)) {
    return /unresolved (elf )?import|undefined symbol|failed to load|not found.*\.prx/i.test(blocker) ? "Converts" : "Starts";
  }
  return null;
}

export function platformOf(system: string): Platform | null {
  const text = system.toLowerCase();
  if (/windows|\bwin ?1[01]\b|mingw|msys/.test(text)) return "windows";
  if (/mac ?os|apple silicon|\bm[1-5] (pro|max|ultra)?\b/.test(text)) return "macos";
  if (/linux|arch|ubuntu|fedora|debian|mint|cachyos|steam ?os|steam deck|nixos|manjaro|pop!?_?os|bazzite|gentoo|opensuse|endeavour|wsl/.test(text)) return "linux";
  return null;
}

const GPU_PATTERNS: [vendor: string, pattern: RegExp][] = [
  ["NVIDIA", /\b(?:(?:nvidia\s+)?(?:geforce\s+)?(?:rtx|gtx)\s*\d{3,4}(?:\s*(?:ti|super))?(?:\s*laptop)?)/i],
  ["AMD", /\b(?:(?:amd\s+)?radeon\s+(?:rx\s*)?\d{3,4}m?(?:\s*(?:xtx|xt|gre))?|rx\s*\d{3,4}(?:\s*(?:xtx|xt|gre))?)/i],
  ["Intel", /\b(?:intel\s+)?(?:arc\s+[ab]\d{3}|iris\s+xe|uhd graphics\s*\d*)/i],
  ["Apple", /\bapple\s+m[1-5](?:\s*(?:pro|max|ultra))?/i],
  ["Software", /\bllvmpipe|lavapipe|swiftshader\b/i],
];

export function gpuOf(system: string): { gpu: string | null; vendor: string | null } {
  for (const [vendor, pattern] of GPU_PATTERNS) {
    const match = system.match(pattern);
    if (match) return { gpu: match[0].replace(/\s+/g, " ").trim(), vendor };
  }
  if (/nvidia|geforce/i.test(system)) return { gpu: null, vendor: "NVIDIA" };
  if (/\bamd\b|radeon|radv/i.test(system)) return { gpu: null, vendor: "AMD" };
  if (/intel/i.test(system)) return { gpu: null, vendor: "Intel" };
  return { gpu: null, vendor: null };
}

export function buildKindOf(commit: string): BuildKind {
  const text = commit.toLowerCase();
  if (/branch|local|patch|fork|tree\/|uncommitted|own change|wip/.test(text)) return "patched";
  if (/#\d+|pull\/\d+|\bprs?\b/.test(text)) return "prs";
  if (/\bmain\b|\bv?\d+\.\d+\.\d+\b|\brelease\b|^[`\s]*[0-9a-f]{7,40}[`\s]*$/.test(text)) return "main";
  return "unknown";
}

const FIELD = {
  furthest: ["furthest point", "furthest", "reached", "status"],
  system: ["system tested", "system", "host", "tested on", "hardware"],
  commit: ["anyps5 commit", "commit", "build", "anyps5 build", "branch"],
  version: ["content version tested", "content version", "version", "game version"],
  shown: ["what is shown", "what's shown", "shown", "result"],
  blocker: ["current blocker", "blocker", "blockers", "open blockers", "stops at"],
};

/** Blocker sections can hold whole logs; the start names the stop. */
const BLOCKER_LIMIT = 2000;

export interface PostMeta {
  url: string;
  discussion: number;
  author: string | null;
  date: string;
}

/** Turns one discussion post or reply into a report, or null when it states no furthest point. */
export function parseReport(body: string, meta: PostMeta): Report | null {
  const sections = formSections(body);
  const field = (names: string[]) => names.map((n) => sections[n]).find(Boolean) ?? inlineField(body, names);

  const furthest = field(FIELD.furthest);
  const blocker = field(FIELD.blocker) ?? "";
  const reached = furthest && answer(furthest);
  const stage = reached ? stageFromFurthest(reached, blocker) : null;
  if (!stage) return null;

  const system = field(FIELD.system) ?? "";
  const commit = field(FIELD.commit);
  const { gpu, vendor } = gpuOf(system);

  return {
    ...meta,
    stage,
    platform: platformOf(system),
    gpu,
    gpuVendor: vendor,
    build: commit ? clean(firstLine(commit)) : null,
    buildKind: commit ? buildKindOf(commit) : "unknown",
    prs: commit ? issueRefs(commit) : [],
    version: field(FIELD.version)?.match(/\d{2}\.\d{3}(?:\.\d{3})?/)?.[0] ?? null,
    shown: field(FIELD.shown) ? clean(firstParagraph(field(FIELD.shown)!)) : null,
    blockers: issueRefs(blocker),
    blockerText: blocker.trim() ? blocker.trim().slice(0, BLOCKER_LIMIT) : null,
  };
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[*_`:]/g, "").replace(/\s+/g, " ").trim();
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "";
}

function firstParagraph(text: string): string {
  return text.split(/\n\s*\n/)[0];
}

function clean(text: string): string {
  const plain = text.replace(/`/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 280 ? plain.slice(0, 277).trimEnd() + "…" : plain;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
