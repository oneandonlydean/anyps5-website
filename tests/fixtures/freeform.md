## Tested

- **Title:** Ghost of Yōtei, PPSA26344, v1.008
- **Host:**
  - Windows 11 Pro, Intel Core i9-11900H (Tiger Lake, 8 cores), 32 GB RAM, 32-64 GB page file.
  - NVIDIA RTX 3080 Laptop GPU 16 GB, driver 610.62.
  - Relinked with `--windows --to-intel`. Built with MinGW-w64 GCC 15.2.0.
- **Last update:** 2026-10-05. 24 of the 26 pull requests below are merged; #648 and #653 are open.

## Status

Not in game. With the pull requests below on `main`, the title:
- resolves all its imports (its own `libc.prx` included);
- reaches its entry point, starts its job threads and opens its `/app0/cache_ps5` files;
- allocates 13.5 GiB of direct memory and makes 835 fixed mappings up to 0xFC_0000_0000;
- creates its AudioOut2 graph: two 7.1.4 beds, 38 object ports, pad speaker and vibration;
- registers DCC display buffers, creates the Vulkan device and runs its first compute passes.

Its first frame submission (8440 dwords, ending in a FLIP) is accepted and starts executing. It then stops in the "Tiled Decals" compute pass (blocker A). No frame has been presented yet.

## Open blockers

| | Stop | Seen |
|---|---|---|
| A | `compute shader 0x80003aa700: GetImageResource dword 0 is not a valid runtime value`. The image descriptor is loaded from a descriptor table at an offset computed from the thread id inside a loop. | Every launch, a few seconds in |
| B | `[gpu] skipped draw: unsupported PA_CL_CLIP_CNTL flags (register 0x204 = 0x01080000)`. Draws are skipped; not fatal. | Every launch. Covered by #678 (merged) |
| C | Tessellation. The `tessellationAvailable=0` log line was printed before the feature was read (#687 (merged)); the device has it. The native LS/HS/DS path is not complete: no lowering of the HS/DS ring and LDS accesses, no tessellation configuration passed to the recompiler, and the title's LS programs end in `s_swappc_b64` with a null destination. The title has at least 7 tessellated programs. | Not reached yet; design in progress |

A and C are being worked on locally; follow-up pull requests will be linked here.

<details>
<summary>Stops on <code>main</code>, in the order they are hit</summary>

| Stop | Covered by |
|---|---|
| `Failed to load module libs\libSceUsbd.prx` (needed module, nothing imported) | #636 (merged) |
| Unresolved imports of the title's `libc.prx`: `sceKernelSyncOnAddressWait32/64` | #633 (merged) |
| Unresolved imports of the title's `libc.prx`: the three `libSceLibcInternalExt` thread-exit functions | #641 (merged) |
| Unresolved imports of the executable: `dbOlWdppb4o` (libSceAgc) | #651 (merged) |
| Unresolved imports of the executable: the `scePsmlMfsr*1100` functions | #644 (merged) |
| Unresolved imports of the executable: 11 libSceVoiceQoS functions | #645 (merged) |
| Unresolved imports of the executable: the libSceRazorCpu markers | #632 (merged) |
| Unresolved imports of the executable: `sceAudioOut2Set3DLatency` | #649 (merged) |
| Unresolved imports of the executable: `sceNpCommerceSetPsStoreIconLayout` | #634 (merged) |
| Unresolved imports of the executable: `sceNpSessionSignalingRequestPrepare` | #635 (merged) |
| Unresolved imports of the executable: `sceHttpParseStatusLine` | #642 (merged) |
| `sceMsgDialogClose` unresolved: the title imports it from `libSceMsgDialog.native` | #643 (merged) |
| `sceSystemServiceParamGetString not implemented` | #640 (merged) |
| `create direct memory backing: Insufficient system resources` (Windows commit limit, see the page file note below) | #650 (merged), see also #637 |
| `VideoOut: unsupported ... buffer option` (option 8, STRICT_COLORIMETRY) | #647 (merged) |
| `VideoOut: DCC presentation is not implemented` | #648 (stacked on #647 (merged)) |
| `shared mapping outside the guest arena`: the title reserves its own range at 0x90_0000_0000 and makes fixed maps up to 0xFC_0000_0000 | #652 (merged) |
| `sceAudioOut2PortCreate: data format 0xc00 is not implemented` (12 channels, 7.1.4) | #653 |
| `WRITE_DATA engine, cache or reserved fields are not implemented` (cache policy 2) | #654 (merged) |
| `atomic image descriptor uses an unsupported format` (`image_atomic_fmax` on a 32_FLOAT surface) | #659 (merged) |
| `DPP control 336 is not supported` (DPP16 `row_share`) | #660 (merged) |
| `COND_EXEC ... not implemented`, in the first frame submission | #673 (merged) |

#646 (merged) is also needed, but not as a stop: `sceAgcGetIsTrinityMode` does not write the title's out pointer.

</details>

<details>
<summary>Found by an offline sweep of all 21,610 shaders in the title's packs (not reached in-game yet)</summary>

| Gap | Programs | Covered by |
|---|---|---|
| `global_*` with VCC as SADDR | 29 (character shaders) | #750 |
| VOP1 SDWA `v_mov_b32` byte selectors with PRESERVE | 1 | #751 |
| `DB_SHADER_CONTROL.CONSERVATIVE_Z_EXPORT` | 1 | #752 |
| Loops whose exits reach different program ends | 2 | #753 |
| `s_swappc_b64` with a null destination, long branches, dword jump tables | 11 (+7 tessellation LS) | #754 |
| GDS | 1,635 | #285 (tested with this title, see the comment there) |

</details>

<details>
<summary>Notes</summary>

- **Page file:** on Windows, each direct memory allocation is a committed page-file section. With the default automatic page file, 32 GB of RAM and a normal desktop, the commit limit was too small for the title's 13.5 GiB. A 32-64 GB page file fixed that (#650 (merged)). #637 changes how this memory is committed.
- **Guest arena holes:** the relinked executable has high-entropy ASLR, so stacks that Windows creates before `libc.prx` reserves the guest arena can land inside it. In this title's range this was seen at 0xA6_61xx_xxxx and 0xD6_48xx_xxxx. A fixed map over such a hole throws. #679 (merged) keeps those stacks below the arena.
- **Astro Bot:** blocker A of #357 (`shared mapping outside the guest arena`, intermittent) may be related to #652 (merged) or to the ASLR note above. Not established.

</details>