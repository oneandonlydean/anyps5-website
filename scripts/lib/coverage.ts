/**
 * Measures how much of the RDNA 2 instruction set, image formats and descriptor types the upstream shader recompiler
 * handles, by reading its source. Every number is derived from code and AMD's ISA data; nothing is listed by hand.
 *
 * The scanner reads the decoder's opcode tables and rule lists. When upstream restructures one of them the scanner
 * stops with an error naming what it could not find, instead of publishing a wrong number.
 */
import type { Form, IsaForm } from "./isa";

export type Files = Map<string, string>;

const RECOMPILER = "core/shader/recompiler/";
const DECODER = `${RECOMPILER}RdnaDecoder/src/`;
const AGC_DRIVER = "core/libs/prx/libSceAgcDriver/";
const TEXTURE_FORMATS = `${AGC_DRIVER}Graphics/src/TextureFormat.cpp`;
export const SCANNED_DIRECTORIES = [RECOMPILER.slice(0, -1), AGC_DRIVER.slice(0, -1)];

export class ScanError extends Error {
  constructor(what: string) {
    super(`Coverage scanner: ${what}. Upstream may have restructured this code; update scripts/lib/coverage.ts.`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// C++ text

/** Replaces comments with spaces, keeping string literals and line breaks so offsets and line numbers still match. */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'") {
      // Raw strings are rare enough in this code base to treat as ordinary ones.
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The text between the braces that follow `header`, matched with string literals skipped. */
export function bodyAfter(source: string, header: RegExp): string | null {
  const match = header.exec(source);
  if (!match) return null;
  const open = source.indexOf("{", match.index + match[0].length - 1);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return null;
}

function functionBody(source: string, name: string): string | null {
  return bodyAfter(source, new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*(?:const\\s*)?\\{`));
}

function arrayBody(source: string, name: string): string | null {
  return bodyAfter(source, new RegExp(`\\b${name}\\s*(?:\\[[^\\]]*\\])?\\s*=?\\s*\\{`));
}

/** `case RdnaOpcode::X:` labels in a function's switch. */
function caseNames(body: string, type: string): Set<string> {
  return new Set([...body.matchAll(new RegExp(`case\\s+${type}::(\\w+)\\s*:`, "g"))].map((m) => m[1]));
}

const hex = (text: string) => Number.parseInt(text, 16);

function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new ScanError(`no ${what}`);
  return value;
}

/** Joins the files under a directory into one comment-free text, for patterns that do not care which file holds them. */
function joined(files: Files, prefix: string): string {
  return [...files]
    .filter(([path]) => path.startsWith(prefix) && !/\/tests?\//.test(path))
    .map(([, text]) => stripComments(text))
    .join("\n");
}

/** The first non-null result of `extract` over the non-test sources, so a declaration in a header does not shadow the definition. */
function search<T>(files: Files, what: string, extract: (text: string) => T | null): T {
  for (const [path, raw] of files) {
    if (/\/tests?\//.test(path)) continue;
    const found = extract(stripComments(raw));
    if (found !== null) return found;
  }
  throw new ScanError(`no ${what}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Decoder

/** The decoder's opcode tables and the rules that accept or refuse modifier words, read from its source. */
export interface Decoder {
  /** Opcode number → RdnaOpcode name, per encoding table. */
  tables: Map<string, Map<number, string>>;
  /** Number–name pairs decoded outside the tables (cache-control and timer instructions). */
  loose: Map<string, Set<number>>;
  vop3Vop2Refused: Set<number>;
  families: Set<string>;
  /** Opcodes refused in DPP forms, or null in older trees that predate the rules. */
  dpp: { noDpp: Set<string>; noDpp8: Set<string> } | null;
}

/** Runs a scan, turning a missing structure into null when `lenient` (for old trees) instead of failing. */
function attempt<T>(lenient: boolean, scan: () => T): T | null {
  if (!lenient) return scan();
  try {
    return scan();
  } catch (error) {
    if (error instanceof ScanError) return null;
    throw error;
  }
}

// Opcode tables are arrays or switch functions named after their encoding: vop1Opcodes, decodeSop1Opcode…
const TABLE_KEYS = ["vop3encodedvop1", "vop3p", "vop3", "vopc", "vop2", "vop1", "vintrp", "sop1", "sop2", "sopc", "sopk", "sopp", "smem", "mubuf", "mtbuf", "flat", "ds", "image"];
const TABLE_ENCODING: Record<string, string> = { vop3encodedvop1: "VOP3:VOP1", image: "MIMG" };
// Top-level declarations start in column 0; indented lines are statements inside them.
const BLOCK = /^(?![\s}#])(?:[\w:<>&*,]+[ \t]+)*?(\w+)\s*(?:\[\]\s*=|\()/gm;
// Array entries `{0x03u, RdnaOpcode::VAddF32, …}` and switch cases `case 0x17u: case 0x18u: return RdnaOpcode::X;`, where
// every label in a stacked run decodes to the same opcode.
const PAIR = /\{\s*0x([0-9a-fA-F]+)u?\s*,\s*RdnaOpcode::(\w+)/g;
const CASES = /((?:case\s+0x[0-9a-fA-F]+u?\s*:\s*)+)return\s+RdnaOpcode::(\w+)/g;
const LABEL = /0x([0-9a-fA-F]+)/g;

export function scanDecoder(files: Files, lenient = false): Decoder {
  const tables = new Map<string, Map<number, string>>();
  const loose = new Map<string, Set<number>>();
  for (const [path, raw] of files) {
    if (!path.startsWith(DECODER) || !path.endsWith(".cpp")) continue;
    const text = stripComments(raw);
    const starts = [...text.matchAll(BLOCK)].map((m) => ({ at: m.index, name: m[1] }));
    starts.push({ at: text.length, name: "" });
    for (let b = 0; b < starts.length - 1; b++) {
      const block = text.slice(starts[b].at, starts[b + 1].at);
      const key = starts[b].name.toLowerCase().replace(/^(decode|lookup)/, "");
      const table = TABLE_KEYS.find((k) => key.startsWith(k));
      if (table) {
        const encoding = TABLE_ENCODING[table] ?? table.toUpperCase();
        const entries = tables.get(encoding) ?? new Map<number, string>();
        for (const m of block.matchAll(PAIR)) entries.set(hex(m[1]), m[2]);
        for (const m of block.matchAll(CASES)) for (const label of m[1].matchAll(LABEL)) entries.set(hex(label[1]), m[2]);
        if (entries.size) tables.set(encoding, entries);
      } else {
        // A helper that mentions both an opcode number and an RdnaOpcode. Each pair only counts later if AMD's ISA
        // gives that instruction that opcode, so unrelated numbers in the same function are harmless.
        const numbers = [...block.matchAll(/\b0x([0-9a-fA-F]+)u?\b/g)].map((m) => hex(m[1]));
        for (const [, name] of block.matchAll(/RdnaOpcode::(\w+)/g)) {
          const set = loose.get(name) ?? new Set<number>();
          numbers.forEach((n) => set.add(n));
          loose.set(name, set);
        }
      }
    }
  }
  for (const encoding of ["SOP1", "SOP2", "SOPC", "SOPK", "SOPP", "VOP1", "VOP2", "VOPC", "VOP3", "VOP3:VOP1", "VOP3P", "SMEM", "MUBUF", "MTBUF", "FLAT", "DS", "MIMG"]) {
    if (!tables.get(encoding)?.size) throw new ScanError(`no ${encoding} opcode table`);
  }

  const required = (name: string) => search(files, `${name}()`, (text) => functionBody(text, name));
  const dispatch = joined(files, DECODER);

  return {
    tables,
    loose,
    vop3Vop2Refused: new Set(
      ["isUnsupportedVop3EncodedVop2Alias", "isVop2LiteralMadOpcode"].flatMap((f) => [...required(f).matchAll(/0x([0-9a-fA-F]+)u?/g)].map((m) => hex(m[1]))),
    ),
    families: new Set([...dispatch.matchAll(/case\s+RdnaInstructionFamily::(\w+)\s*:/g)].map((m) => m[1])),
    dpp: attempt(lenient, () => ({
      noDpp: caseNames(required("hasDppForm"), "RdnaOpcode"),
      noDpp8: caseNames(required("acceptsDpp8"), "RdnaOpcode"),
    })),
  };
}

const camel = (name: string) =>
  name
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join("");

/** The RdnaOpcode the decoder produces for an ISA form, or null when the decoder refuses it. */
export function decodes(d: Decoder, f: IsaForm): string | null {
  const table = (encoding: string, opcode: number) => d.tables.get(encoding)?.get(opcode) ?? null;
  const base = (): string | null => {
    switch (f.encoding) {
      case "GLOBAL":
      case "SCRATCH":
        // GLOBAL and SCRATCH are segments of the FLAT encoding and share its opcode table.
        return table("FLAT", f.opcode);
      case "EXP":
        return d.families.has("EXP") ? "Exp" : null;
      default: {
        const hit = table(f.encoding, f.opcode);
        if (hit) return hit;
        const name = camel(f.name);
        return d.loose.get(name)?.has(f.opcode) ? name : null;
      }
    }
  };

  switch (f.form) {
    case "base":
      return base();
    case "vop3": {
      // Mirrors lookupVop3Opcode: VOPC opcodes keep their number, VOP2 ones start at 0x100, VOP1 ones at 0x180.
      const direct = table("VOP3", f.opcode);
      if (direct) return direct;
      if (f.encoding === "VOPC" && f.opcode <= 0xff) return table("VOPC", f.opcode);
      if (f.encoding === "VOP2" && f.opcode >= 0x100 && f.opcode <= 0x13f) {
        return d.vop3Vop2Refused.has(f.opcode - 0x100) ? null : table("VOP2", f.opcode - 0x100);
      }
      if (f.encoding === "VOP1" && f.opcode >= 0x180 && f.opcode <= 0x1ff) return table("VOP3:VOP1", f.opcode - 0x180);
      return null;
    }
    case "dpp16":
    case "dpp8": {
      // hasDppForm and acceptsDpp8 refuse whole opcodes; DPP control values are not opcode-specific.
      const op = base();
      if (!op || !d.dpp || d.dpp.noDpp.has(op) || (f.form === "dpp8" && d.dpp.noDpp8.has(op))) return null;
      return op;
    }
  }
}

/** RdnaOpcodes that the translator's emit switches handle. */
export function translatorCases(files: Files): Set<string> {
  const text = joined(files, `${RECOMPILER}Translation/`);
  const names = new Set<string>();
  for (const emit of ["emitScalar", "emitVector", "emitMemory", "emitInterpolation"]) {
    const body = need(bodyAfter(text, new RegExp(`\\bTranslationContext::${emit}\\s*\\(`)), `TranslationContext::${emit}()`);
    caseNames(body, "RdnaOpcode").forEach((n) => names.add(n));
  }
  if (names.size === 0) throw new ScanError("RdnaOpcode cases in the translator");
  // Exports are dispatched by family in TranslateInstruction rather than through an emit switch.
  if (/case\s+RdnaInstructionFamily::EXP\s*:/.test(text)) names.add("Exp");
  return names;
}

// ---------------------------------------------------------------------------------------------------------------
// Unsupported throws

export interface ThrowSite {
  file: string;
  line: number;
  message: string;
}

const UNSUPPORTED = /unsupported|not (?:yet )?(?:implemented|supported)|unimplemented/i;
const UNSUPPORTED_TYPES = /^throw\s+(?:\w+::)*(?:UnsupportedInstructionError|\w*Unsupported\w*)\b/;
const THROW = /\bthrow\b(?:[^;"']|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')*;/g;

/** `throw` statements in the recompiler whose message or exception type says something is unsupported. */
export function unsupportedThrows(files: Files): ThrowSite[] {
  const sites: ThrowSite[] = [];
  for (const [path, raw] of files) {
    if (!path.startsWith(RECOMPILER) || /\/tests?\//.test(path)) continue;
    const text = stripComments(raw);
    for (const m of text.matchAll(THROW)) {
      const statement = m[0];
      if (statement === "throw;") continue;
      const message = [...statement.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((s) => s[1]).join("…");
      if (!UNSUPPORTED.test(message) && !UNSUPPORTED_TYPES.test(statement)) continue;
      sites.push({ file: path.slice(RECOMPILER.length), line: text.slice(0, m.index).split("\n").length, message: message || statement.replace(/\s+/g, " ") });
    }
  }
  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

const REQUIRE = /\bRequire\s*\((?:[^;"']|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')*\)\s*;/g;

/**
 * Every error the recompiler and the graphics driver can stop with: `throw` statements and `Require(condition,
 * message)` checks that carry a message. Game pages match reported errors against these. File paths are from the
 * repository root.
 */
export function errorSites(files: Files): ThrowSite[] {
  const sites: ThrowSite[] = [];
  for (const [path, raw] of files) {
    if (!(path.startsWith(RECOMPILER) || path.startsWith(AGC_DRIVER)) || /\/tests?\//.test(path)) continue;
    const text = stripComments(raw);
    for (const pattern of [THROW, REQUIRE]) {
      for (const m of text.matchAll(pattern)) {
        const message = [...m[0].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((s) => s[1]).join("…");
        if (message.replace(/…/g, "").length < 16) continue;
        sites.push({ file: path, line: text.slice(0, m.index).split("\n").length, message });
      }
    }
  }
  return sites;
}

/** The recompiler component a file belongs to: its first directory, or "Recompiler" for top-level files. */
export const area = (file: string) => (file.includes("/") ? file.slice(0, file.indexOf("/")) : "Recompiler");

// ---------------------------------------------------------------------------------------------------------------
// Image formats and descriptor types

export interface FormatRow {
  value: number;
  name: string | null;
  /** The recompiler can sample a texture in this format. */
  sampled: boolean;
  /** The recompiler can read and write a typed buffer in this format. */
  buffer: boolean;
  /** The graphics driver maps it to a Vulkan format for textures. */
  host: boolean;
}

export function imageFormats(files: Files, lenient = false): FormatRow[] {
  const enumText = search(files, "IrBufferFormat enum", (text) => arrayBody(text, "enum\\s+class\\s+IrBufferFormat\\s*:\\s*[\\w:]+"));
  const names = new Map([...enumText.matchAll(/(\w+)\s*=\s*(\d+)/g)].map((m) => [Number(m[2]), m[1]]));

  const defined = search(files, "DefinedImageFormats", (text) => arrayBody(text, "DefinedImageFormats"));
  const ranges = [...defined.matchAll(/\{\s*(\d+)u?\s*,\s*(\d+)u?\s*\}/g)].map((m) => [Number(m[1]), Number(m[2])]);
  if (!ranges.length) throw new ScanError("no DefinedImageFormats ranges");

  const infoTable = search(files, "kFormatInfoTable", (text) => arrayBody(text, "kFormatInfoTable"));
  const sampled = new Set([...infoTable.matchAll(/\{\s*IrBufferFormat::(\w+)\s*,\s*true\b/g)].map((m) => m[1]));

  const buffer = caseNames(search(files, "GetFormatInfo()", (text) => functionBody(text, "GetFormatInfo")), "IrBufferFormat");

  const textures = files.get(TEXTURE_FORMATS);
  // Older trees predate the driver's format table; today's scan must find it, or every format would read unsupported.
  if (!textures && !lenient) throw new ScanError(TEXTURE_FORMATS);
  const host = new Set<number>();
  if (textures) {
    const text = stripComments(textures);
    const lookup = arrayBody(text, "kFormatLookup") ?? "";
    for (const m of lookup.matchAll(/\{\s*(\d+)\s*,\s*VK_FORMAT_/g)) host.add(Number(m[1]));
    // Formats the driver remaps onto another one it supports.
    const remap = functionBody(text, "remapGuestFormat") ?? "";
    const target = Number(remap.match(/\?\s*(\d+)\s*:/)?.[1]);
    if (host.has(target)) for (const m of remap.matchAll(/==\s*(\d+)/g)) host.add(Number(m[1]));
    if (!host.size) throw new ScanError("no kFormatLookup entries");
  }

  const rows: FormatRow[] = [];
  for (const [first, last] of ranges) {
    for (let value = first; value <= last; value++) {
      const name = names.get(value) ?? null;
      rows.push({ value, name, sampled: !!name && sampled.has(name), buffer: !!name && buffer.has(name), host: host.has(value) });
    }
  }
  return rows;
}

export interface DescriptorRow {
  name: string;
  handled: boolean;
}

/** Image descriptor types, and whether the resource materializer maps each one to a shader image dimension. */
export function descriptorTypes(files: Files): DescriptorRow[] {
  const enumBody = search(files, "ImageType enum", (text) => arrayBody(text, "enum\\s+class\\s+ImageType\\s*:\\s*[\\w:]+"));
  const all = [...enumBody.matchAll(/(\w+)\s*=/g)].map((m) => m[1]);
  const handled = caseNames(search(files, "descriptorDimension()", (text) => functionBody(text, "descriptorDimension")), "ImageType");
  return all.map((name) => ({ name, handled: handled.has(name) }));
}

// ---------------------------------------------------------------------------------------------------------------
// Totals

export interface FormCount {
  encoding: string;
  form: Form;
  total: number;
  decoded: number;
  translated: number;
  /** ISA instruction names the recompiler does not decode in this form. */
  missing: string[];
}

/** One measurement. In lenient mode, a part whose source structure does not exist yet is null. */
export interface Snapshot {
  /** Per encoding and form; DPP forms are left out when the tree has no rules for them. */
  forms: FormCount[] | null;
  /** Instructions the decoder accepts but the translator has no case for. */
  untranslated: string[];
  throws: ThrowSite[];
  formats: FormatRow[] | null;
  descriptors: DescriptorRow[] | null;
}

export function measure(files: Files, isa: IsaForm[], lenient = false): Snapshot {
  const instructions = attempt(lenient, () => measureForms(files, isa, lenient));
  return {
    forms: instructions?.forms ?? null,
    untranslated: instructions?.untranslated ?? [],
    throws: unsupportedThrows(files),
    formats: attempt(lenient, () => imageFormats(files, lenient)),
    descriptors: attempt(lenient, () => descriptorTypes(files)),
  };
}

function measureForms(files: Files, isa: IsaForm[], lenient: boolean) {
  const decoder = scanDecoder(files, lenient);
  const translated = translatorCases(files);
  const groups = new Map<string, FormCount>();
  const untranslated = new Set<string>();
  for (const f of isa) {
    if (!decoder.dpp && (f.form === "dpp16" || f.form === "dpp8")) continue;
    const key = `${f.encoding} ${f.form}`;
    const group = groups.get(key) ?? { encoding: f.encoding, form: f.form, total: 0, decoded: 0, translated: 0, missing: [] };
    groups.set(key, group);
    group.total++;
    const op = decodes(decoder, f);
    if (!op) {
      group.missing.push(f.name);
      continue;
    }
    group.decoded++;
    if (translated.has(op)) group.translated++;
    else untranslated.add(f.name);
  }
  return {
    forms: [...groups.values()].sort((a, b) => a.encoding.localeCompare(b.encoding) || FORM_ORDER.indexOf(a.form) - FORM_ORDER.indexOf(b.form)),
    untranslated: [...untranslated].sort(),
  };
}

export const FORM_ORDER: Form[] = ["base", "vop3", "dpp16", "dpp8"];
