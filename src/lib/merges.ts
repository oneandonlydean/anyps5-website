import { titleIds } from "./ids";

/** A merged upstream pull request, as the sync stores it. */
export interface Merge {
  number: number;
  title: string;
  mergedAt: string;
  author: string | null;
  labels: string[];
}

export type MergeArea = "libraries" | "gpu" | "shader" | "relinker" | "converter" | "project";

export const AREA_LABEL: Record<MergeArea, string> = {
  libraries: "System libraries",
  gpu: "GPU driver",
  shader: "Shader recompiler",
  relinker: "Relinker",
  converter: "Web converter",
  project: "Tools and docs",
};

/** Areas in the order updates list them. */
export const AREAS: MergeArea[] = ["libraries", "gpu", "shader", "relinker", "converter", "project"];

const TYPE_LABEL: Record<string, string> = { feat: "Feature", fix: "Fix", perf: "Performance", revert: "Revert" };

export interface ClassifiedMerge extends Merge {
  /** The conventional-commit type: feat, fix, perf, test, docs... or "other". */
  type: string;
  area: MergeArea;
  /** The library a system-library change is in, as the title spells it ("libSceFont"). */
  library: string | null;
  /** The title without its "type(scope):" prefix. */
  summary: string;
  /** Title IDs the title names, such as a game the change unblocks. */
  titleIds: string[];
  /** A user-facing change: a feature, fix, speed-up or revert outside tools and docs. */
  notable: boolean;
  url: string;
}

function areaOf(scope: string | null, labels: string[]): MergeArea {
  const s = scope?.toLowerCase().split(/[,/\s]/)[0] ?? "";
  if (/^(agc|libsceagcdriver|gpu|vulkan)$/.test(s)) return "gpu";
  if (/^(shader|recompiler|spirv)/.test(s)) return "shader";
  if (/^(relinker|elf|codegen|elfpatcher)/.test(s)) return "relinker";
  if (/^(web|converter|wasm)$/.test(s)) return "converter";
  if (/^(lib|prx$|pad$|kernel$)/.test(s)) return "libraries";
  if (s) return "project";
  // No scope: fall back on the labels upstream puts on pull requests.
  const has = (name: string) => labels.includes(name);
  if (has("agc")) return "gpu";
  if (has("shader")) return "shader";
  if (has("relinker")) return "relinker";
  if (has("prx") || has("libc") || has("libkernel")) return "libraries";
  return "project";
}

export function classify(merge: Merge, repo = "boykopovar/AnyPS5"): ClassifiedMerge {
  const m = merge.title.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  const type = m?.[1] ? m[1].toLowerCase() : /^revert\b/i.test(merge.title) ? "revert" : "other";
  const scope = m?.[2]?.trim() ?? null;
  const area = areaOf(scope, merge.labels);
  return {
    ...merge,
    type,
    area,
    library: area === "libraries" && scope && /^lib/i.test(scope) ? scope : null,
    summary: m?.[3] ?? merge.title,
    titleIds: titleIds(merge.title),
    notable: type in TYPE_LABEL && area !== "project",
    url: `https://github.com/${repo}/pull/${merge.number}`,
  };
}

export const typeLabel = (type: string) => TYPE_LABEL[type] ?? "Change";
