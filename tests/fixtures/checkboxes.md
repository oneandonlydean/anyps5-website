### Existing thread

- [x] I searched this category for the title ID and no thread exists for this title on any platform.

### Title

ccleste (PPSA59322)

### Content version tested

The homebrew catalog build (release zip `PPSA59322`), the Celeste Classic port with its own assets in `app0/assets`.

### AnyPS5 commit

`main` 8b3e39832a plus the `libSceAgcDriver` change for #9783 on macOS; `main` a6dcea9279 on Linux. Last updated 2026-10-22.

### System tested

macOS 26.2, Apple M5, Apple clang 21, x86-64 under Rosetta 2, MoltenVK (MBridge build); and an Ubuntu 24.04 x86-64 container under Rosetta with llvmpipe (Mesa, LLVM 20.1.2).

### Furthest point

- [ ] Does not convert
- [x] Stops before the first frame
- [ ] Logos or loading screen
- [ ] Menu
- [ ] In game

### What is shown

Nothing is presented yet. The title starts, opens the pad, loads its sounds and music (`ui kit: 0 songs, 67 sounds (0 rejected), output playing`, `celeste: 23 effects, 5 songs`) and stops at its first draw.

### Current blocker

On macOS with MoltenVK, plain `main` stops at the first draw because the pixel shader exports raw 32-bit values into a `COLOR_8` UINT target and Metal refuses the pipeline (`output of type float4 is not compatible with a MTLPixelFormatR8Uint color attachment`): #9783, pull request linked there. With that change the next stop on this MoltenVK is

```
AGC driver: a pixel shader on the mesh path reads barycentrics, and this device has neither VK_KHR_fragment_shader_barycentric nor mesh shaders
```

which is a capability of the MoltenVK build (the extension is listed, its feature reports false), noted on #1.

On Linux with llvmpipe the stop is llvmpipe's mesh output limit: `ShaderRecompiler::Recompile: barycentric emulation on the mesh path needs 36864 bytes of mesh output memory, the device allows 32768`. A real GPU is the next step.

The macOS conversion needs `main`'s relinker; the `ci/macos-series-2` tree's refuses the eboot with `Guest TLS access without a non-empty PT_TLS`.

### How it was run

macOS: `relinker --macos --to-rosetta --registry src/eboot.elf app` (main's relinker) with the package as `app0/`, then `./app` with `VK_DRIVER_FILES` pointing at MoltenVK's ICD and `SDL_AUDIODRIVER=dummy`. Linux: `--to-rosetta`, run through `/lib64/ld-linux-x86-64.so.2 ./app.elf` under `xvfb-run`.
