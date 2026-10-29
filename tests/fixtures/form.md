### Existing thread

- [x] I searched this category for the title ID and no thread exists for this title on any platform.

### Title

Assassin's Creed Mirage (PPSA13960)

### Content version tested

01.007.000

### AnyPS5 commit

`main` a120df3486 (the format 36 fix below was also rebuilt and its tests rerun on `main` abed035468).

### System tested

Arch Linux (kernel 7.2.11), AMD Radeon RX 9070 XT with RADV (Mesa 26.2.5), built from source with GCC 16.2.1, Release

### Furthest point

Logos or loading screen

### What is shown

Its start-up screens, as before: the photosensitivity warning, the Ubisoft logo, an intro video, the disclaimer and the autosave notice, then a black screen. Frame rate, input and audio were not checked (SDL dummy driver).

### Current blocker

On `main` a120df3486 the title stops 86 to 91 s after start, since #8898:

```
compute shader 0x10b4e03d00: AGC graphics: sampling multisampled color target 0x10e0720000 (960x540, 4 samples, vk format 122) as a 960x540 texture of 4 samples and guest format 36 (vk 98) is not implemented
```

#11691 fixes it. With #11691 the title stops at 83 s on:

```
AGC graphics: a CPU read of 0x10dfd20000+0x1fe0000 overlaps multisampled color target 0x10e0720000+0x870000 (4 samples), whose samples are only on the host: guest access to it is not implemented
```

With #11691 and #8223 that read passes, and the title stops at 87 s on a partial clear of a 1x storage image whose last 0x200000 bytes cover the 4x target (traced in #8223's thread); no open pull request covers it yet:

```
compute shader 0x1000810a00: AGC graphics: a cached image access of 0x10dc1d0000+0x480000 overlaps multisampled color target 0x10dc450000+0x480000 (4 samples), whose samples are only on the host: guest access to it is not implemented
```

Open pull requests this title needs, in the order it hits them:
- #7532: without it, the title sometimes stops with SIGSEGV on the main thread about 3 s after start, right after it opens `/app0/streaminginstall.ini` (twice in five starts today, with builds based on `main` a120df3486).
- #11691: the format 36 sampling stop above.
- #8223: the CPU read above.

Merged since the first post: #6343 (kevent read event on descriptor 0) and #7533 (cube descriptors with slices past their last whole cube).

### How it was run

`relinker --registry eboot.bin app.elf`, with no other options. Cross every 30 s through the emulator's pad input file (`APS5_PAD_INPUT_FILE`).

AI-assisted: yes
