# AnyPS5 website

The official website for [AnyPS5](https://github.com/boykopovar/AnyPS5). It has the web converter, a setup guide, the release docs, downloads, implementation progress, and the game compatibility list.

Static [Astro](https://astro.build) site. The demo runs on Cloudflare; GitHub Pages is an option (see [Deploy](#deploy)).

## Develop

```sh
npm install
npm run fetch:upstream   # converter bundle, release info, docs and progress
npm run dev              # http://localhost:4321
```

The committed `data/generated/` files are enough to build the compatibility pages. `fetch:upstream` without `--libraries` skips the ~100 MB library archives. In development, the converter fetches them through a proxy to the upstream Pages site.

| Command | What it does |
|---|---|
| `npm run build` | Build the site into `dist/` |
| `npm test` | Unit tests for the report parser and stage resolution |
| `npm run validate` | Check `data/games/*.yaml` |
| `npm run check` | Type-check |
| `npm run sync` | Refresh all compatibility data (needs a GitHub token) |
| `npm run fetch:upstream -- --libraries` | Fetch everything for a deployable converter |
| `npm run fetch:coverage` | Measure shader recompiler coverage from upstream source |

Scripts that call GitHub use `GITHUB_TOKEN`, or `gh auth token` when it is unset. `SGDB_API_KEY` enables SteamGridDB art; without it, art comes from the PlayStation Store only. `sync:art` also reads it from a local `.env` file, which is not committed.

## How compatibility works

Every game sits on an eight-stage ladder: Converts, Loads, Starts, First draw, Presents, Menus, Ingame, Playable. "Not converting" sits below it.

1. **Reports.** `sync:reports` reads every thread in the upstream [Game bring-up](https://github.com/boykopovar/AnyPS5/discussions/categories/game-bring-up) discussions, opening posts and replies. It parses each report's furthest point, system, GPU, build and blockers into `data/generated/threads.json`. The parser is `src/lib/parse.ts`, tested against real posts in `tests/fixtures/`.
2. **Names and issues.** `sync:titles` maps title IDs to official names. `sync:issues` records the state of every issue or pull request that a report names as a blocker.
3. **Art.** `sync:art` resolves cover, hero, logo and square art from the PlayStation Store, plus SteamGridDB when a key is set, and each game's dominant colour. Images are hotlinked, never stored.
4. **Screenshots.** `sync:reports` also records every image posted in those threads. `sync:screenshots` downloads each one once, leaves out icons and odd shapes, and writes small WebP copies to `public/community/` (not committed) with their size and dominant colour in `data/generated/screenshots.json`. Game pages show them in a gallery, credited to the tester with a link to their post; a build without the copies shows none.
5. **Curation.** `data/games/<slug>.yaml` files override any of the above. See [CONTRIBUTING.md](CONTRIBUTING.md).
6. **Resolution.** `src/lib/resolve.ts` groups threads into games by title ID. The headline stage comes from the best report on a `main` or release build. Higher stages reached only with open pull requests or local patches show separately. A curated stage wins until a newer report goes further.

The sync workflow (manual for now) opens a pull request whose description lists stage changes and new games, so a person reviews every change before it goes live. Pull requests opened with the workflow's own token do not trigger CI; use a personal access token or app token if they should.

## How progress is measured

The [progress page](src/pages/progress.astro) has two halves, and neither is maintained by hand.

- **System libraries** come from upstream's own `progress.json` and `history.json`, fetched by `fetch:upstream`. The page draws them as a treemap. Function names load from `/progress/functions.json` when someone hovers or opens a library.
- **Shader recompiler** numbers come from `fetch:coverage`:
  - It keeps a blobless clone of upstream `main` in `node_modules/.cache/` and downloads AMD's machine-readable RDNA 2 ISA.
  - It reads the recompiler's source with `scripts/lib/coverage.ts`: the decoder's opcode tables, its DPP refusal lists, the translator's cases, the format tables, the descriptor mapping and every "unsupported" or "not implemented" throw.
  - It measures today's `main` and the last commit of each earlier day with the same rules, so the history charts stay comparable.
  - Today's measurement is strict: if upstream reorganises the code the scanner reads, it fails with an error naming what it could not find, rather than publishing a wrong number. Older days are lenient: a structure that did not exist yet becomes a gap in the chart.
- **What games are waiting on.** The sync keeps each report's blocker text. At build time `src/lib/needs.ts` matches it against two sources: every declared function (`progress-functions.json`) and every error message the recompiler and graphics driver can raise (`error-sites.json`, written by `fetch:coverage`). Game pages list the matches as **What it needs**, and the progress page ranks the ones named by the most games.
- **Not measured yet:** operand modifiers (VOP3 abs, neg, clamp and omod, op_sel, SDWA selects). Whether one is accepted depends on bit patterns that only running the decoder can show.

## Other generated pages

- `/report` builds a bring-up report in the discussion form's own `### Field` layout, ready to paste. It fills in the OS and GPU from the browser, and nothing leaves the page until the person posts it.
- `/updates` and the Atom feed at `/updates.xml` are built from data the site already has: each game's stage timeline, recent releases (`releases.json`), and weekly differences in library and recompiler progress.
- `/badge/<slug>.svg` is a status badge for each game. Game pages show the Markdown to embed it.
- `npm run build` ends with Pagefind, which indexes `dist/` for the search dialog (Ctrl+K). Search only works on a built site, not in `npm run dev`.

## Languages

The home page, the setup guide and the FAQ exist in English, Spanish, Brazilian Portuguese, Simplified Chinese and Russian, under `/es/`, `/pt-br/`, `/zh-cn/` and `/ru/`. Every other page is English only. The setup guide lives in the docs, at `/docs/guide`; old `/guide` links redirect there.

- **Interface text:** strings live in `src/i18n/<locale>.ts`. `en.ts` is the source, and TypeScript fails the build if a translation is missing a key.
- **Guide steps:** translations live in `src/content/guide/<locale>/`, with the same file names as the English steps. A step without a translation falls back to English.
- **Links:** inside translated text, links use English paths, and the pages point them at the reader's language where a translation exists.
- **Adding a language:** add it to `src/i18n/locales.ts`, add a strings file, and translate the guide folder.

## Cloudflare demo

`npm run deploy:demo` builds the site for https://anyps5-demo.deanisa.ninja and deploys it as a Cloudflare Worker with static assets (`wrangler.jsonc`). It is marked `noindex`.

The converter's library archives are bigger than Cloudflare's 25 MiB file limit, so `worker/index.ts` streams them from upstream's Pages site.

`npm run refresh:demo` refreshes every data source first, then deploys. To run it daily, install the systemd user timer:

```sh
cp scripts/systemd/anyps5-demo-refresh.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now anyps5-demo-refresh.timer
```

The log is in `~/.local/state/anyps5-demo/refresh.log`. User timers only run while you are logged in. Run `loginctl enable-linger` to make them run at any time.

## Run reports and maintainer tools

People can sign in with GitHub and upload the `anyps5-report.json` AnyPS5 writes after a run. The brief for the runtime side is `docs/proposals/run-report.md`, and the format is `src/lib/run-report.ts`.

- **Upload checks:** the Worker validates each upload strictly against the schema. It refuses reports that contradict themselves (impossible milestones, dates in the future) and flags claims that contradict the source code, such as a "missing" function that is implemented or an "unsupported" instruction the recompiler translates. Flagged reports wait for a maintainer.
- **Confirmations:** an upload counts toward a game's stage once two different accounts reach it, or one account and a Discussions report do. Until then the game page shows it as "1 of 2 confirmations".
- **Maintainer tools:** maintainers (the `MAINTAINERS` variable in `wrangler.jsonc`) get hide buttons on game pages, for screenshots, the cover, backdrop and logo, and uploaded reports. `/moderate` has a review queue, hidden items, account blocking and a log of every action.
- **How changes reach the site:** uploads and maintainer actions live in the `anyps5-site` D1 database. `sync:uploads` pulls them into the build from `/api/export`. With `SITE_DISPATCH_TOKEN` set, the Worker asks this repository to rebuild after each change, at most every 2 minutes.

To switch sign-in on, create a GitHub OAuth app (Settings → Developer settings → OAuth Apps) with the callback URL `https://<site>/auth/github/callback`. Then set `SITE_GITHUB_CLIENT_ID` and `SITE_GITHUB_CLIENT_SECRET` with `npx wrangler secret put <NAME> --env=""` (or `--env production`). For rebuilds, `SITE_DISPATCH_TOKEN` is a fine-grained token with "Contents: read and write" on this repository.

## Discord bot

The site's Worker (`worker/`) also runs the Discord bot that was the separate gh-worker:

- **Linked roles:** members link their GitHub account and get roles by merged pull request count.
- **Slash commands:** `/prs` and `/leaderboard`.
- **Announcements:** every minute it checks for merges and posts each one as it lands. Merges are sorted with the same classifier as `/updates` (`src/lib/merges.ts`):

| Webhook secret | What goes there |
|---|---|
| `DISCORD_WEBHOOK_PROGRESS` | Features, fixes and speed-ups (falls back to `DISCORD_WEBHOOK_URL`). Each post is coloured by area, with the area, type, size and any game the pull request names. A linked author is pinged. |
| `DISCORD_WEBHOOK_DEV` | Tests, docs and tooling merges. Not posted when unset. |
| `DISCORD_WEBHOOK_RELEASES` | New releases, checked every 5 minutes. |
| `DISCORD_WEBHOOK_GAMES` | Games reaching a new stage, read from the site's games feed every 10 minutes. |

The bot runs only in the `production` environment of `wrangler.jsonc`, which has the database and secrets. The demo has neither, so its bot endpoints return 404 and it has no cron. Its tests run in the Workers runtime: `npm run test:worker`.

### Cutover from gh-worker

The production environment uses gh-worker's D1 database, so linked members, the merge history and the announcement cursor carry over. On the day:

1. Set the official domain in `env.production.routes` and `BASE_URL` in `wrangler.jsonc`.
2. Set the secrets on the new Worker with `npx wrangler secret put <NAME> --env production`:
   - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_TOKEN`
   - `TOKEN_KEY`: the **same value** gh-worker uses. Linked members' Discord tokens are encrypted with it; with a new key they would all have to link again.
   - the webhooks above
3. Stop gh-worker's cron (remove its trigger, or delete the Worker), so the two never post the same merge or refresh the same tokens.
4. Deploy: `npx wrangler deploy --env production`. Then run `npm --prefix worker run migrate:remote`; it is a no-op unless new migrations were added.
5. In the Discord developer portal, point these at the new domain:
   - Interactions Endpoint URL: `/interactions`
   - Linked Roles Verification URL: `/linked-role`
   - OAuth2 redirect: `/discord/callback`

   In the GitHub OAuth app, set the callback URL to `/github/callback`. The slash commands stay registered and need no change.
6. Point `.github/workflows/site.yml` at the production deploy (no `noindex` header) instead of `deploy:demo`.

## Layout

```
worker/             the Cloudflare Worker: library proxy and Discord bot, with its own tests
src/pages/          routes: home, compatibility, convert, docs (with the setup guide), download, progress, community, og images
src/content/guide/  setup guide, one MDX file per step
src/lib/            data loading, parsing, resolution, docs rendering, OG images
scripts/            data sync, upstream fetch, validation, sync summaries
data/games/         curated game files
data/generated/     synced data, committed by the sync workflow
```

## Deploy

The live demo is on Cloudflare (see [Cloudflare demo](#cloudflare-demo)). There, a small Worker streams the converter's large library archives from upstream.

### Automatic updates

`.github/workflows/site.yml` refreshes all data, builds and deploys to Cloudflare:

- **On a push to `main`:** when this site's code changes.
- **On an upstream ping:** a `repository_dispatch` event of type `upstream-updated`, sent by upstream after a merge or release.
- **Every 3 hours:** it builds only if something the site shows has changed upstream: the latest release, the published library progress, the shader recompiler or GPU driver source, or the bring-up discussions. While this repository is private, more frequent checks would use up its free Actions minutes; once it is public, every 30 minutes is fine.
- **Daily:** a full refresh regardless.

It needs these repository secrets:

- `CLOUDFLARE_API_TOKEN`: create one from Cloudflare's "Edit Cloudflare Workers" template, limited to this account and the `deanisa.ninja` zone.
- `CLOUDFLARE_ACCOUNT_ID`
- `SGDB_API_KEY`: optional.

For the upstream ping, upstream adds this step to its workflows. It needs a fine-grained token, stored as an upstream secret, with "Contents: read and write" on this repository only:

```yaml
- name: Tell the website to update
  if: github.ref == 'refs/heads/main'
  run: gh api repos/oneandonlydean/anyps5-website/dispatches -f event_type=upstream-updated
  env:
    GH_TOKEN: ${{ secrets.WEBSITE_DISPATCH_TOKEN }}
```

### GitHub Pages

`.github/workflows/deploy.yml` can also publish to GitHub Pages, which serves the archives itself. It is manual-only for now. To use it:

- Enable GitHub Pages with "GitHub Actions" as the source.
- Set the repository variable `SITE_URL` to the site's public URL, and add `public/CNAME` for a custom domain.
- Restore the push and schedule triggers in the workflow.

`SITE_REPO_URL` in `src/lib/site.ts` points the "Suggest a correction" links at this repository.

## Legal

AnyPS5 is not affiliated with Sony Interactive Entertainment. Game art belongs to its publishers and is shown from the PlayStation Store and SteamGridDB. Title names come from [andshrew/PlayStation-Titles](https://github.com/andshrew/PlayStation-Titles).
