import { loadGenerated } from "./load";

export interface ReleaseAsset {
  name: string;
  size: number;
  sha256: string | null;
  url: string;
}

export interface Release {
  tag: string;
  name: string;
  url: string;
  published: string;
  assets: ReleaseAsset[];
}

export interface ProgressGroup {
  name: string;
  label: string;
  done: number;
  total: number;
  /** Implemented functions whose body does nothing observable (only discards arguments and returns a constant). */
  inert: number;
}

export interface ProgressPart {
  done: number;
  total: number;
  percent: number;
  groups: ProgressGroup[];
}

export interface ProgressDay {
  date: string;
  libraries: { done: number; total: number };
}

/** Coverage of the shader recompiler, measured from its source by scripts/fetch-coverage.ts. */
export interface Coverage {
  commit: string;
  date: string;
  isa: string;
  instructions: { total: number; decoded: number; translated: number };
  dpp: { total: number; decoded: number };
  formats: { total: number; sampled: number; buffer: number; host: number };
  throws: { total: number; areas: { name: string; count: number }[]; sites: { file: string; line: number; message: string }[] };
  forms: { encoding: string; form: "base" | "vop3" | "dpp16" | "dpp8"; total: number; decoded: number; translated: number; missing: string[] }[];
  untranslated: string[];
  formatRows: FormatRow[];
  descriptors: { name: string; handled: boolean }[];
  history: {
    date: string;
    commit: string;
    instructions: { total: number; decoded: number; translated: number } | null;
    dpp: { total: number; decoded: number } | null;
    formats: { total: number; sampled: number; buffer: number; host: number } | null;
    throws: number;
  }[];
}

export interface FormatRow {
  value: number;
  name: string | null;
  sampled: boolean;
  buffer: boolean;
  host: boolean;
}

export const getRelease = () => loadGenerated<Release | null>("release.json", null);
export const getProgress = () => loadGenerated<{ libraries: ProgressPart; shaders: ProgressPart } | null>("progress.json", null);
export const getProgressHistory = () => loadGenerated<ProgressDay[]>("progress-history.json", []);
export const getCoverage = () => loadGenerated<Coverage | null>("coverage.json", null);
/** Function name → [library label, 1 when implemented]. Served per library by /progress/functions.json. */
export const getFunctions = () => loadGenerated<Record<string, [string, 0 | 1]>>("progress-functions.json", {});

