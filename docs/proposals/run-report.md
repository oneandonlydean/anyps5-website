# Run report file: brief for the AnyPS5 main repo

## Goal

Today the compatibility list and the shader progress page learn about a game only from what testers type into the Game bring-up form. The site then guesses blockers by matching error text against the source. The runtime already knows exactly what happened in a run. If it writes that down in a small, structured file, testers can share precise results in seconds, including people who never post in Discussions, and the site can show exactly what each game needs.

What we want from the main repo: **every run writes `anyps5-report.json`, a structured summary of the run, which the user can switch off.** The file stays on the user's machine. Nothing is uploaded unless the user shares it.

Please turn this brief into a plan (where the writer lives, how each field is detected, cost, tests) before building. The format below is a draft; change it where the runtime makes something hard or impossible, and tell us, because the website will validate it strictly.

## The toggle

- On by default (local file only), unless the maintainers prefer it off by default. That decision is theirs.
- Off with `APS5_REPORT=0`, a `report = off` setting in the runtime's ini, or a command-line flag. Document all three in `USAGE.md`.
- Uploading is a separate feature for later: an explicit opt-in (`APS5_REPORT_UPLOAD=1`, off by default) that posts the same file to the website. Don't build it in the first version.

## Where and when

- Written next to the game's executable, as `anyps5-report.json`, overwriting the previous run's file.
- Written when the run ends: clean exit, crash, unsupported-feature abort, or the user closing the game. If the process dies too hard to write it, the next start may write a report for the previous run, marked `"exit": "killed"`.
- At most 64 KiB, UTF-8, pretty-printed so a person can read it before sharing.

## Format (version 1)

```json
{
  "format": "anyps5-report",
  "version": 1,
  "generated": "2026-10-29T12:00:00Z",
  "anyps5": { "commit": "40-hex commit of the runtime build", "release": "v0.1.3", "modified": false },
  "game": {
    "titleId": "PPSA12345",
    "contentId": "UP9000-PPSA12345_00-EXAMPLE0000000000",
    "contentVersion": "01.002.000",
    "name": "Title from the game's own metadata"
  },
  "system": {
    "os": "linux",
    "osVersion": "Arch Linux (kernel 6.11)",
    "cpu": "AMD Ryzen 7 5800X",
    "ramGiB": 32,
    "gpu": { "vendor": "AMD", "name": "Radeon RX 6800", "driver": "Mesa 24.2.3 (RADV)", "vulkan": "1.3.289" }
  },
  "run": {
    "seconds": 312,
    "exit": "crash",
    "stage": "presents",
    "milestones": { "loaded": 1.2, "started": 1.4, "firstDraw": 8.9, "firstPresent": 9.3 },
    "framesPresented": 4120,
    "averageFps": 41.7
  },
  "missing": {
    "functions": [{ "library": "libSceNpTrophy", "name": "sceNpTrophyCreateContext", "calls": 3 }]
  },
  "shaders": {
    "compiled": 1234,
    "failed": 3,
    "unsupported": [{ "encoding": "VOP3", "opcode": "V_CVT_PK_U8_F32", "modifiers": ["clamp"], "count": 2 }],
    "imageFormats": [{ "format": 37, "name": "Format8_8_8_8Srgb", "supported": false, "count": 1 }],
    "descriptors": [{ "type": "SampledImage", "supported": true }]
  },
  "stop": {
    "kind": "unsupported-shader",
    "message": "First line of the error that stopped the run, at most 300 characters",
    "source": "core/shader/recompiler/Translator/src/Vop3.cpp:812"
  }
}
```

Field rules:

- **Enumerations.**
  - `os`: `linux`, `windows`, `macos`.
  - `gpu.vendor`: `AMD`, `NVIDIA`, `Intel`, `Apple`, `Other`.
  - `exit`: `clean`, `crash`, `abort`, `killed`.
  - `stop.kind`: `none`, `missing-function`, `unsupported-shader`, `unsupported-format`, `crash`, `assert`, `other`.
- **`run.stage` is the furthest milestone the runtime can prove:** `converts`, `loads` (every import resolved, entry point reached), `starts` (game code ran its main thread), `first-draw` (first GPU draw or dispatch submitted), `presents` (first frame presented). The runtime can't tell menus from gameplay, so it never claims `menus`, `ingame` or `playable`; the tester adds those.
- **`milestones`** are seconds since start; leave out the ones not reached.
- **Lists are capped:** `missing.functions` and `shaders.unsupported` at 200 entries each, the rest at 100. Sort by count, highest first.
- **Strings are capped at 300 characters.** No free text other than `stop.message`, `game.name` and the system descriptions.
- **Versioning:** adding fields keeps `version: 1`; renaming, removing or changing the meaning of a field is `version: 2`.

## Privacy

The file must never contain:
- usernames, home directory paths, hostnames, or IP or MAC addresses
- hardware serial numbers, PSN or account IDs
- save data, screenshots, or the game's files

Paths are relative to the game folder or the AnyPS5 source tree. Users should be able to read the whole file and see that nothing personal is in it.

## Deliverables

1. The writer in the runtime, with the toggle.
2. `docs/run-report.schema.json`: a JSON Schema for version 1, the single source of truth both repos validate against.
3. `USAGE.md` documentation: what's in the file, the toggle, and how to share it.
4. Sample reports for each `stop.kind` (they become test fixtures for the website).
5. A "Run report" field in `.github/DISCUSSION_TEMPLATE/game-bring-up.yml` where testers paste the file, rendered as a JSON code block.

## What the website does with it (for context)

- **Report helper (`/report`):** the tester drops the file in. It's read in the browser, validated against the schema, fills in the form, and adds the report as a fenced JSON block to the Discussions post.
- **Discussion sync:** reads that block from posts, so the stage, missing functions and unsupported shader instructions come from the runtime instead of guesses.
- **Direct upload (later):** for people who don't post in Discussions, an upload on the website. It's strictly validated, protected against bots and rate limited, and the result is shown as an automatic report, kept apart from reports with a person behind them.
- **What the data feeds:**
  - per game: exactly which functions, instructions and formats block it
  - progress page: shader work ranked by how many games each instruction blocks
  - compatibility list: new games added from their title ID
