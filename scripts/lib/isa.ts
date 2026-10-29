import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import { root } from "./files";

/** AMD's machine-readable GPU ISA specification (MIT). This URL redirects to the newest release. */
const ISA_URL = "https://gpuopen.com/download/machine-readable-isa/latest/";
const ISA_FILE = "amdgpu_isa_rdna2.xml";
const CACHE = resolve(root, "node_modules/.cache/anyps5-isa");

/**
 * How an instruction is encoded. `base` is its own encoding; `vop3` is a VOP1, VOP2 or VOPC instruction in the
 * 64-bit VOP3 encoding; `dpp16` and `dpp8` add a lane-swizzle word to a VOP1 or VOP2 instruction.
 *
 * SDWA forms are left out: whether the decoder accepts one depends on the selector bits in its modifier word, which a
 * source scan cannot tell apart, so counting them would need a harness that runs the decoder.
 */
export type Form = "base" | "vop3" | "dpp16" | "dpp8";

export interface IsaForm {
  name: string;
  /** The instruction's own encoding: SOP1, VOP2, MIMG, GLOBAL… */
  encoding: string;
  form: Form;
  /** The opcode in this form's opcode field. */
  opcode: number;
}

const VECTOR = new Set(["VOP1", "VOP2", "VOPC"]);

/** Downloads the newest ISA release, cached on disk by its file name so an unchanged release is not fetched again. */
export async function loadIsaXml(): Promise<string> {
  const head = await fetch(ISA_URL, { redirect: "manual" });
  const target = head.headers.get("location");
  if (!target) throw new Error(`ISA download did not redirect: ${head.status}`);
  const zip = resolve(CACHE, target.split("/").pop()!);
  const bytes = await readFile(zip).catch(async () => {
    const response = await fetch(new URL(target, ISA_URL));
    if (!response.ok) throw new Error(`ISA download failed: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    await mkdir(CACHE, { recursive: true });
    await writeFile(zip, data);
    return data;
  });
  const files = unzipSync(new Uint8Array(bytes), { filter: (f) => f.name.endsWith(ISA_FILE) });
  const xml = Object.values(files)[0];
  if (!xml) throw new Error(`${ISA_FILE} is missing from the ISA release`);
  return new TextDecoder().decode(xml);
}

/** Every encoded form of every instruction in the ISA. Literal-constant variants are folded into their encoding. */
export function parseIsa(xml: string): IsaForm[] {
  const start = xml.indexOf("<Instructions>");
  if (start < 0) throw new Error("ISA XML has no <Instructions>");
  const forms: IsaForm[] = [];
  for (const instruction of xml.slice(start).matchAll(/<InstructionName>(\w+)<\/InstructionName>([\s\S]*?)<\/InstructionEncodings>/g)) {
    const name = instruction[1];
    const encodings = [...instruction[2].matchAll(/<EncodingName>(\w+)<\/EncodingName>[\s\S]*?<Opcode Radix="10">(\d+)<\/Opcode>/g)].map((m) => ({
      tag: m[1],
      opcode: Number(m[2]),
    }));
    const native = encodings.map((e) => e.tag.match(/^ENC_(\w+)$/)?.[1]).find((tag) => tag && tag !== "VOP3");
    for (const { tag, opcode } of encodings) {
      const form = classify(tag, native);
      if (form) forms.push({ name, opcode, ...form });
    }
  }
  return forms;
}

function classify(tag: string, native: string | undefined): Pick<IsaForm, "encoding" | "form"> | null {
  if (tag === "ENC_VOP3" || tag === "VOP3_SDST_ENC") {
    return native && VECTOR.has(native) ? { encoding: native, form: "vop3" } : { encoding: "VOP3", form: "base" };
  }
  if (tag === "ENC_FLAT_GLBL") return { encoding: "GLOBAL", form: "base" };
  if (tag === "ENC_FLAT_SCRATCH") return { encoding: "SCRATCH", form: "base" };
  const own = tag.match(/^ENC_(\w+)$/);
  if (own) return { encoding: own[1], form: "base" };
  const modified = tag.match(/^(VOP1|VOP2|VOPC)_VOP_(DPP16|DPP8)$/);
  if (modified) return { encoding: modified[1], form: modified[2].toLowerCase() as Form };
  return null;
}
