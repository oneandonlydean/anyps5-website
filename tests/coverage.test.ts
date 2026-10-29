import { describe, expect, it } from "vitest";
import { bodyAfter, decodes, descriptorTypes, imageFormats, measure, scanDecoder, ScanError, stripComments, unsupportedThrows, type Files } from "../scripts/lib/coverage";
import { parseIsa, type IsaForm } from "../scripts/lib/isa";

const R = "core/shader/recompiler/";
const D = `${R}RdnaDecoder/src/`;

const scalar = `
RdnaOpcode decodeSop1Opcode(std::uint32_t opcode) {
    switch (opcode) {
        case 0x03u: return RdnaOpcode::SMovB32;
        default: throw UnsupportedInstructionError("SOP1 opcode");
    }
}
`;

const vector = `
constexpr Vop2OpcodeInfo vop2Opcodes[] = {
    {0x03u, RdnaOpcode::VAddF32, Vop2SdwaProfile::Float},
    {0x0du, RdnaOpcode::VMacF32},
};
constexpr VectorOpcodeInfo vop1Opcodes[] = {
    {0x01u, RdnaOpcode::VMovB32},
    {0x42u, RdnaOpcode::VMovrelsB32},
};
constexpr VectorOpcodeInfo vop3EncodedVop1Opcodes[] = {
    {0x01u, RdnaOpcode::VMovB32},
};
constexpr VopcOpcodeInfo vopcOpcodes[] = {
    {0x01u, RdnaOpcode::VCmpLtF32},
};
constexpr VectorOpcodeInfo vop3Opcodes[] = {
    {0x140u, RdnaOpcode::VMadLegacyF32},
};
constexpr VectorOpcodeInfo vop3pOpcodes[] = {
    {0x00u, RdnaOpcode::VPkMadI16},
};
bool isVop2LiteralMadOpcode(std::uint32_t opcode) {
    return opcode == 0x20u;
}
bool isUnsupportedVop3EncodedVop2Alias(std::uint32_t opcode) {
    return isVop2LiteralMadOpcode(opcode) || opcode == 0x0du;
}
bool hasDppForm(RdnaOpcode opcode) {
    switch (opcode) {
        case RdnaOpcode::VReadfirstlaneB32:
            return false;
        default: return true;
    }
}
bool acceptsDpp8(RdnaOpcode opcode) {
    switch (opcode) {
        case RdnaOpcode::VMovrelsB32:
            return false;
        default: return hasDppForm(opcode);
    }
}
`;

// Memory tables, including one whose name contains "sopc" (dsOpcodes) to check tables are matched by prefix.
const memory = `
constexpr MemoryOpcodeInfo smemOpcodes[] = { {0x00u, RdnaOpcode::SLoadDword} };
constexpr MemoryOpcodeInfo mubufOpcodes[] = { {0x0cu, RdnaOpcode::BufferLoadDword} };
constexpr MemoryOpcodeInfo mtbufOpcodes[] = { {0x00u, RdnaOpcode::TbufferLoadFormatX} };
constexpr MemoryOpcodeInfo flatOpcodes[] = { {0x0cu, RdnaOpcode::FlatLoadDword} };
constexpr MemoryOpcodeInfo dsOpcodes[] = { {0x00u, RdnaOpcode::DsAddU32} };
RdnaOpcode cacheControlOpcode(RdnaInstructionFamily family, std::uint32_t opcode) {
    switch (opcode) {
        case 0x71u: return RdnaOpcode::BufferGl0Inv;
        default: return RdnaOpcode::Invalid;
    }
}
`;

const others = `
RdnaOpcode decodeSop2Opcode(std::uint32_t o) { switch (o) { case 0x00u: return RdnaOpcode::SAddU32; } }
RdnaOpcode decodeSopcOpcode(std::uint32_t o) { switch (o) { case 0x00u: return RdnaOpcode::SCmpEqI32; } }
RdnaOpcode decodeSopkOpcode(std::uint32_t o) { switch (o) { case 0x00u: return RdnaOpcode::SMovkI32; } }
RdnaOpcode decodeSoppOpcode(std::uint32_t o) { switch (o) { case 0x01u: return RdnaOpcode::SEndpgm; } }
constexpr ImageOpcodeInfo imageOpcodes[] = { {0x00u, RdnaOpcode::ImageLoad} };
RdnaInstruction DecodeRdnaEncodedInstruction(std::uint32_t pc) {
    switch (family) {
        case RdnaInstructionFamily::EXP: return DecodeRdnaExport(pc);
    }
}
`;

const translator = `
bool TranslationContext::emitScalar(const RdnaInstruction& inst) {
    switch (inst.op) {
        case RdnaOpcode::SMovB32: return true;
        default: return false;
    }
}
bool TranslationContext::emitVector(const RdnaInstruction& inst) {
    switch (inst.op) {
        case RdnaOpcode::VMovB32:
        case RdnaOpcode::VAddF32: return true;
        default: return false;
    }
}
bool TranslationContext::emitMemory(const RdnaInstruction& inst) { switch (inst.op) { case RdnaOpcode::FlatLoadDword: return true; default: return false; } }
bool TranslationContext::emitInterpolation(const RdnaInstruction& inst) { switch (inst.op) { default: return false; } }
void TranslationContext::TranslateInstruction(const RdnaInstruction& instruction) {
    switch (instruction.family) {
        case RdnaInstructionFamily::EXP: eXP(instruction); break;
    }
}
`;

const formats = `
enum class IrBufferFormat : std::uint32_t {
    Invalid = 0,
    Format8UNorm = 1,
    Format8SNorm = 2,
};
inline constexpr std::array<ImageFormatRange, 1> DefinedImageFormats{{{1u, 3u}}};
enum class ImageType : std::uint32_t {
    Color1D = 8,
    Color2D = 9,
};
constexpr std::array<FormatInfo, 2> kFormatInfoTable {{
    {IrBufferFormat::Format8UNorm, true, false, false},
    {IrBufferFormat::Format8SNorm, false, false, false},
}};
SpirvBufferFormatInfo GetFormatInfo(IrBufferFormat format);
SpirvBufferFormatInfo GetFormatInfo(IrBufferFormat format) {
    switch (format) {
        case IrBufferFormat::Format8SNorm: return {};
        default: throw std::runtime_error("unsupported buffer format");
    }
}
RdnaImageDimension descriptorDimension(const DescriptorValue& descriptor) {
    switch (rawImageType(descriptor)) {
        case ImageType::Color2D: return RdnaImageDimension::Dim2D;
        default: throw std::runtime_error("image descriptor has an unsupported type");
    }
}
`;

const files: Files = new Map([
  [`${D}RdnaScalarOpDecoder.cpp`, scalar + others],
  [`${D}RdnaVectorOpDecoder.cpp`, vector],
  [`${D}RdnaMemoryOpDecoder.cpp`, memory],
  [`${R}Translation/src/Dispatch.cpp`, translator],
  [`${R}IntermediateRepresentation/include/BufferFormat.hpp`, formats],
]);

const form = (name: string, encoding: string, f: IsaForm["form"], opcode: number): IsaForm => ({ name, encoding, form: f, opcode });

describe("C++ text helpers", () => {
  it("strips comments but keeps strings and line numbers", () => {
    const source = 'a // x\n/* y\nz */ "// kept" b';
    const stripped = stripComments(source);
    expect(stripped).toContain('"// kept"');
    expect(stripped).not.toContain("x");
    expect(stripped.split("\n")).toHaveLength(3);
  });

  it("matches braces past string literals", () => {
    expect(bodyAfter('f() { g("}"); { h(); } } tail', /f\(\)\s*\{/)).toBe(' g("}"); { h(); } ');
  });
});

describe("decoder coverage", () => {
  const decoder = scanDecoder(files);

  it("reads opcode tables by name prefix", () => {
    expect(decoder.tables.get("DS")?.get(0)).toBe("DsAddU32");
    expect(decoder.tables.get("SOPC")?.get(0)).toBe("SCmpEqI32");
    expect(decodes(decoder, form("S_MOV_B32", "SOP1", "base", 3))).toBe("SMovB32");
    expect(decodes(decoder, form("S_NOP", "SOP1", "base", 0x7f))).toBeNull();
  });

  it("shares the FLAT table with GLOBAL and SCRATCH", () => {
    expect(decodes(decoder, form("GLOBAL_LOAD_DWORD", "GLOBAL", "base", 0x0c))).toBe("FlatLoadDword");
  });

  it("accepts loose pairs only when the ISA name matches", () => {
    expect(decodes(decoder, form("BUFFER_GL0_INV", "MUBUF", "base", 0x71))).toBe("BufferGl0Inv");
    expect(decodes(decoder, form("BUFFER_GL1_INV", "MUBUF", "base", 0x71))).toBeNull();
  });

  it("follows the VOP3 opcode ranges and refused aliases", () => {
    expect(decodes(decoder, form("V_ADD_F32", "VOP2", "vop3", 0x103))).toBe("VAddF32");
    expect(decodes(decoder, form("V_MAC_F32", "VOP2", "vop3", 0x10d))).toBeNull();
    expect(decodes(decoder, form("V_MOV_B32", "VOP1", "vop3", 0x181))).toBe("VMovB32");
    expect(decodes(decoder, form("V_CMP_LT_F32", "VOPC", "vop3", 0x01))).toBe("VCmpLtF32");
    expect(decodes(decoder, form("V_MAD_LEGACY_F32", "VOP3", "base", 0x140))).toBe("VMadLegacyF32");
  });

  it("applies the DPP refusal lists", () => {
    expect(decodes(decoder, form("V_MOVRELS_B32", "VOP1", "dpp16", 0x42))).toBe("VMovrelsB32");
    expect(decodes(decoder, form("V_MOVRELS_B32", "VOP1", "dpp8", 0x42))).toBeNull();
  });

  it("reports untranslated instructions", () => {
    const isa = [form("S_MOV_B32", "SOP1", "base", 3), form("V_CMP_LT_F32", "VOPC", "base", 1), form("EXP", "EXP", "base", 0)];
    const snapshot = measure(files, isa, true);
    expect(snapshot.untranslated).toEqual(["V_CMP_LT_F32"]);
    expect(snapshot.forms?.find((f) => f.encoding === "EXP")?.decoded).toBe(1);
  });

  it("fails loudly when a table disappears, unless lenient", () => {
    const broken: Files = new Map(files);
    broken.set(`${D}RdnaVectorOpDecoder.cpp`, vector.replace("hasDppForm", "hasDppVariant"));
    expect(() => scanDecoder(broken)).toThrow(ScanError);
    expect(scanDecoder(broken, true).dpp).toBeNull();
  });
});

describe("unsupported throws", () => {
  it("counts unsupported messages and typed errors, not other throws or comments", () => {
    const source = `
      void f() {
          throw std::runtime_error("FMASK " + name + " is not implemented");
          throw std::invalid_argument("truncated instruction");
          throw UnsupportedInstructionError(opcode);
          // throw std::runtime_error("unsupported in a comment");
          throw;
      }`;
    const sites = unsupportedThrows(new Map([[`${R}Optimization/src/A.cpp`, source]]));
    expect(sites.map((s) => s.line)).toEqual([3, 5]);
    expect(sites[0].message).toBe("FMASK … is not implemented");
  });

  it("ignores tests", () => {
    expect(unsupportedThrows(new Map([[`${R}tests/A.cpp`, 'throw std::runtime_error("unsupported");']]))).toEqual([]);
  });
});

describe("formats and descriptors", () => {
  it("joins the defined range with each layer", () => {
    expect(imageFormats(files)).toEqual([
      { value: 1, name: "Format8UNorm", sampled: true, buffer: false, host: false },
      { value: 2, name: "Format8SNorm", sampled: false, buffer: true, host: false },
      { value: 3, name: null, sampled: false, buffer: false, host: false },
    ]);
  });

  it("lists descriptor types the materializer maps", () => {
    expect(descriptorTypes(files)).toEqual([
      { name: "Color1D", handled: false },
      { name: "Color2D", handled: true },
    ]);
  });
});

describe("ISA parsing", () => {
  it("classifies encodings into forms", () => {
    const xml = `<Instructions>
      <InstructionName>V_MOV_B32</InstructionName><InstructionEncodings>
        <InstructionEncoding><EncodingName>ENC_VOP1</EncodingName><Opcode Radix="10">1</Opcode></InstructionEncoding>
        <InstructionEncoding><EncodingName>ENC_VOP3</EncodingName><Opcode Radix="10">385</Opcode></InstructionEncoding>
        <InstructionEncoding><EncodingName>VOP1_VOP_DPP8</EncodingName><Opcode Radix="10">1</Opcode></InstructionEncoding>
        <InstructionEncoding><EncodingName>VOP1_VOP_SDWA</EncodingName><Opcode Radix="10">1</Opcode></InstructionEncoding>
        <InstructionEncoding><EncodingName>VOP1_INST_LITERAL</EncodingName><Opcode Radix="10">1</Opcode></InstructionEncoding>
      </InstructionEncodings>
      <InstructionName>GLOBAL_LOAD_DWORD</InstructionName><InstructionEncodings>
        <InstructionEncoding><EncodingName>ENC_FLAT_GLBL</EncodingName><Opcode Radix="10">12</Opcode></InstructionEncoding>
      </InstructionEncodings>`;
    expect(parseIsa(xml)).toEqual([
      form("V_MOV_B32", "VOP1", "base", 1),
      form("V_MOV_B32", "VOP1", "vop3", 385),
      form("V_MOV_B32", "VOP1", "dpp8", 1),
      form("GLOBAL_LOAD_DWORD", "GLOBAL", "base", 12),
    ]);
  });
});
