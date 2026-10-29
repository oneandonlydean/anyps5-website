import { describe, expect, it } from "vitest";
import { matcher } from "../src/lib/needs";

const functions = {
  sceAppContentDownloadDataGetAvailableSpaceKb: ["AppContent", 1],
  sceAppContentDownload0Expand: ["AppContent", 0],
  sceAgcCbNop_nid_no_patch: ["Agc", 0],
  scePadRead: ["Pad", 1],
} as const;

const sites = [
  { file: "core/a.cpp", line: 1, message: "buffer descriptor uses an unsupported type" },
  { file: "core/b.cpp", line: 9, message: "buffer descriptor uses an unsupported type" },
  { file: "core/c.cpp", line: 3, message: "AGC graphics: unsupported color format … number type … component swap " },
  { file: "core/d.cpp", line: 4, message: ", is not implemented" },
  { file: "core/e.cpp", line: 5, message: "ShaderRecompiler::Recompile: " },
];

const m = matcher(functions as never, sites);

describe("needs matcher", () => {
  it("classifies named functions against progress data", () => {
    const { functions: found } = m.match(
      "Calls sceAppContentDownloadDataGetAvailableSpaceKb, then sceAppContentDownload0Expand and sceAppContentDownload2Expand; also sceAgcCbNop.",
    );
    expect(found).toEqual([
      { name: "sceAppContentDownloadDataGetAvailableSpaceKb", library: "AppContent", status: "implemented" },
      { name: "sceAppContentDownload0Expand", library: "AppContent", status: "missing" },
      { name: "sceAppContentDownload2Expand", library: "AppContent", status: "undeclared" },
      { name: "sceAgcCbNop", library: "Agc", status: "missing" },
    ]);
  });

  it("ignores family names that prefix a declared function", () => {
    expect(m.match("the scePad calls and scePadRe* family").functions).toEqual([]);
  });

  it("matches errors by their literal parts, grouped by message", () => {
    const { errors } = m.match("terminate: AGC graphics: unsupported color format 19 number type 4 component swap 2; buffer descriptor uses an unsupported type");
    expect(errors.map((e) => e.message)).toEqual(["buffer descriptor uses an unsupported type", "AGC graphics: unsupported color format … number type … component swap "]);
    expect(errors[0].sites).toHaveLength(2);
  });

  it("does not match generic messages", () => {
    expect(m.match("ShaderRecompiler::Recompile: thing, is not implemented").errors).toEqual([]);
  });
});
