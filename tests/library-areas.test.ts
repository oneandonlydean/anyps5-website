import { describe, expect, it } from "vitest";
import { libraryArea } from "../src/lib/library-areas";

describe("libraryArea", () => {
  it.each([
    ["libc", "Core"],
    ["libkernel_sys", "Core"],
    ["libSceAgcDriver", "Graphics"],
    ["libSceVideoOut", "Graphics"],
    ["libSceVideodec2", "Audio and video"],
    ["libScePad", "Input"],
    ["libSceNpEulaDialog", "Network and PSN"],
    ["libSceMsgDialog.native", "Interface and text"],
    ["libSceFreeTypeOt", "Interface and text"],
    ["libSceSaveData.native", "System and storage"],
    ["libSceSomethingNew", "System and storage"],
  ])("puts %s under %s", (name, area) => {
    expect(libraryArea(name)).toBe(area);
  });
});
