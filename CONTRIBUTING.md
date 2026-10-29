# Contributing

## Correct a game

Most game data comes from test reports in the AnyPS5 [Game bring-up](https://github.com/boykopovar/AnyPS5/discussions/categories/game-bring-up) discussions. When the automatic result is wrong or incomplete, add or edit a file in `data/games/`. The **Suggest a correction** link on every game page opens the right file on GitHub.

One file per game, named after the game in lowercase words joined by hyphens: `data/games/hades-ii.yaml`.

```yaml
title_ids: [PPSA36082]          # required; every region's ID for this game
name: Hades II                  # optional; replaces the name from reports or the store
aliases: [Hades 2]              # optional; extra search terms
tags: [Roguelike]               # optional
kind: retail                    # optional: retail, homebrew or app

curated:                        # optional; a maintainer's verdict
  stage: Ingame
  date: 2026-10-20              # when this was checked
  platforms:                    # optional; per-platform stages
    linux: Ingame
    windows: Menus
  note: Crashes entering the second biome.
  blockers: [3134, 3150]        # upstream issue or PR numbers, in the order they stop the game
  verified_by: your-github-name

art:                            # optional; replaces resolved art
  hero: https://example.com/hero.jpg
  logo: null                    # null hides this image
```

Every field except `title_ids` is optional. Unknown fields are errors. Run `npm run validate` before opening a pull request.

### Stages

| Stage | Meaning |
|---|---|
| Not converting | The relinker refuses the executable |
| Converts | The relinker converts the executable |
| Loads | All imports resolve and the executable loads |
| Starts | Game code runs past start-up |
| First draw | The first GPU draw or dispatch executes |
| Presents | Frames reach the screen: logos, loading screens or video |
| Menus | A menu or title screen renders and responds to input |
| Ingame | Gameplay is reached |
| Playable | Playable from start to finish with minor issues |

### How curation interacts with reports

- A curated `stage` wins over reports, unless a report dated after `curated.date` reaches a higher stage on a `main` or release build. That report then replaces it automatically. Update `date` after re-checking a game.
- Curated `blockers` replace the blockers taken from reports. Closed and merged ones are hidden.
- Two files cannot claim the same title ID.

## Change the site

```sh
npm install
npm run fetch:upstream
npm run dev
```

Before opening a pull request, run `npm test`, `npm run validate`, `npm run check` and `npm run build`. Keep pages fast and accessible: the site has no client framework, only small scripts where a page needs them.

The converter under `/convert/app/` is the unmodified upstream release bundle with a theme stylesheet (`src/styles/converter-embed.css`). Fix converter bugs [upstream](https://github.com/boykopovar/AnyPS5).
