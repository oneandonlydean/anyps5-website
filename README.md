# AnyPS5 website

The official website for [AnyPS5](https://github.com/boykopovar/AnyPS5), which relinks PS5 executables into native Linux and Windows programs. Demo: https://demo.anyps5.gg

It has:
- the browser converter
- a setup guide and the release docs
- downloads
- library and shader progress
- updates, with feeds per category
- the game compatibility list, with screenshots and uploaded run reports
- the project's Discord bot

## Contents

- [Quick start](#quick-start)
- [How it fits together](#how-it-fits-together)
- [Where the data comes from](#where-the-data-comes-from)
- [Run reports and maintainer tools](#run-reports-and-maintainer-tools)
- [Discord bot](#discord-bot)
- [Deploying and running](#deploying-and-running)
- [Going live](#going-live)
- [Languages](#languages)
- [Layout](#layout)

## Quick start

Needs Node 24 and, for anything that talks to GitHub, a GitHub token (`GITHUB_TOKEN`, or `gh auth login`).

```sh
npm install
npm run fetch:upstream   # the converter, release info, docs and progress
npm run dev              # http://localhost:4321
```

The committed `data/generated/` files are enough to build every page. In development, the converter's library archives load through a proxy to upstream's Pages site. Search (Ctrl+K) works only on a built site (`npm run build`, then `npx astro preview`). The sign-in, upload and moderation endpoints exist only in the Worker, so on the dev server those panels say the feature isn't available.

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` | Develop / build into `dist/` (the build ends with the Pagefind search index) |
| `npm test` | The site's unit tests |
| `npm run test:worker` | The Worker's tests (bot, sign-in, uploads, moderation), in the Workers runtime |
| `npm run check` | Type-check the site (the Worker: `npm run typecheck --prefix worker`) |
| `npm run validate` | Check the curated game files in `data/games/` |
| `npm run sync` | Refresh compatibility data: reports, titles, issues, art, screenshots, merges and uploads |
| `npm run fetch:upstream` | The converter, release info, docs and library progress (`-- --libraries` also fetches the ~100 MB archives) |
| `npm run fetch:coverage` | Measure the shader recompiler's coverage from upstream source |
| `npm run deploy:demo` | Build and deploy the demo to Cloudflare |
| `npm run deploy:production` | Build and deploy the official site (see [Going live](#going-live)) |

`SGDB_API_KEY` enables SteamGridDB art; without it, art comes from the PlayStation Store only. `sync:art` also reads it from a local `.env` file, which is not committed.

## How it fits together

- **The site** is static [Astro](https://astro.build), built from the data in `data/`, and rebuilt whenever that data changes.
- **The Worker** (`worker/`) serves the built site on Cloudflare and adds what a static site can't:
  - a proxy for the converter's library archives, which are bigger than Cloudflare's 25 MiB file limit
  - GitHub sign-in and run report uploads
  - maintainer tools
  - the Discord bot
- **Two D1 databases:**
  - `anyps5-site`: accounts, uploads and what maintainers hid
  - `gh-discord-roles`: the bot's linked members and merge history
- **GitHub Actions** (`.github/workflows/site.yml`) refreshes the data, runs every test, and deploys. It runs:
  - on pushes
  - every few hours
  - when the Worker asks for a rebuild because an upload, a moderation action or an upstream change came in

## Where the data comes from

Nothing on the site is maintained by hand. Each script below writes to `data/generated/`.

**Compatibility** (`npm run sync`). Every game sits on an eight-stage ladder (Converts, Loads, Starts, First draw, Presents, Menus, Ingame, Playable), with "Not converting" below it.

1. **Reports:** `sync:reports` reads every thread in the [Game bring-up](https://github.com/boykopovar/AnyPS5/discussions/categories/game-bring-up) discussions and parses each report's furthest point, system, GPU, build and blockers (`src/lib/parse.ts`, tested on real posts in `tests/fixtures/`). It also records every image posted.
2. **Names and issues:** `sync:titles` maps title IDs to official names. `sync:issues` records the state of each issue or pull request a report names, including when it closed or merged.
3. **Art:** `sync:art` takes cover, backdrop, logo and square art from the PlayStation Store, then SteamGridDB, plus each game's dominant colour. Images are linked to, never stored.
4. **Screenshots:** `sync:screenshots` downloads each posted image once and writes small WebP copies to `public/community/` (not committed).
5. **Merges:** `sync:merges` keeps the last 30 days of merged upstream pull requests for `/updates`.
6. **Uploads:** `sync:uploads` reads uploaded run reports and maintainer actions from the Worker's `/api/export`.
7. **Builds:** `sync:builds` looks up the commit hash in each report's build text, and in each upload, for its date, and the commit each release was cut from (`src/lib/builds.ts`). Each result is then placed on a release: the release itself, or `main` after it. A report naming no known commit falls back to a release named in its text, then to its date. Lookups are cached in `node_modules/.cache/anyps5-builds.json`.
8. **Curation:** `data/games/<slug>.yaml` files override any of the above. See [CONTRIBUTING.md](CONTRIBUTING.md).
9. **Resolution:** `src/lib/resolve.ts` groups threads into games by title ID. Regional releases with the same name become one game.
   - The headline stage is the best report on a `main` or release build. Stages reached only with open pull requests show separately.
   - A curated stage wins until a newer report goes further.
   - Uploads count once confirmed (see below).
10. **History:** `record:compat` adds the day's games per stage to `/compat-history.json`. Like `/library-history.json`, the record lives on the deployed site: each refresh reads it back from `SITE_API`, because CI keeps nothing between runs. `/progress#games` charts it; days before it started are rebuilt from each game's reports.
11. **Tracked games:** `data/tracked.yaml` lists a fixed set of games, chosen by maintainers, to run on every release. `/compatibility/tracked` shows them release by release. Each game page has a "By release" table, and a newer release that got less far is flagged as a possible regression.

**Progress** (`fetch:upstream` and `fetch:coverage`):
- **System libraries:** from upstream's `progress.json`. When `UPSTREAM_PROGRESS` is set, the output of upstream's own `tools/progress.py --json` run on `main` is used instead, because upstream's published copy lags whenever its Pages deploy fails (see [Measuring library progress on main](#measuring-library-progress-on-main)).
- **Shader recompiler:** `fetch:coverage` reads the recompiler's source on `main` (`scripts/lib/coverage.ts`):
  - opcode tables, DPP rules and translator cases
  - format tables and descriptor mapping
  - every "unsupported" throw

  It does this for today and for the last commit of each earlier day, so the charts stay comparable. Today's measurement fails loudly if upstream reorganises the code, rather than publishing a wrong number.
- **What games are waiting on:** each report's blocker text is matched against every declared function and every error the recompiler and GPU driver can raise (`src/lib/needs.ts`).

**Updates and feeds:**
- **`/updates`:** releases, stage rises, and a daily card that expands into that day's merges by area.
- **Feeds:**

| Feed | What's in it |
|---|---|
| `/updates.xml` | Everything except single merges |
| `/feeds/releases.xml` | New releases |
| `/feeds/progress.xml` | Every feature, fix and speed-up merged upstream (about 160 a day) |
| `/feeds/progress-daily.xml` | One summary per day |
| `/feeds/games.xml` | Games reaching a new stage, games reported lower on a newer release, and a call to retest the tracked games on each new release |

## Run reports and maintainer tools

After a run, AnyPS5 writes `anyps5-report.json` (built by the runtime team on the `run-report-v1` branch). People sign in with GitHub on `/report` and upload it.

- **The format** is upstream's. `src/lib/run-report/run-report.schema.json` is an unchanged copy of their `docs/run-report.schema.json` (version 1, frozen together), and `tests/fixtures/run-reports/` holds their 11 sample reports, which the tests run. To update the format, copy in the new schema and fixtures, then bump `SCHEMA_COMMIT` in `src/lib/run-report.ts`. The brief and replies are in `docs/proposals/`.
- **Checks:** the Worker validates each upload against the schema (at most 64 KiB), then:
  - refuses reports that contradict themselves (milestone order, stage, frame rate)
  - flags claims that contradict the source code, such as a "missing" function that is implemented. Flagged reports wait for a maintainer.

  A run is stored once (by its run id), with at most 30 uploads a day per account. A report without a title ID asks the uploader to choose the game.
- **How far it got:** a run report can only record stages up to Presents. For a run that presented frames, the uploader can say it reached a menu, gameplay or the end, and that stage is what the upload counts towards.
- **Confirmations:** an upload moves a game's stage once two accounts reach it, or one account and a Discussions report by someone else. Until then the game page shows "1 of 2 confirmations".
- **Maintainers:** listed in `MAINTAINERS` in `wrangler.jsonc` by GitHub account id, not login, because logins can be renamed. To find an id, run `gh api users/<login> --jq .id`.
  - On game pages they get hide buttons for screenshots, the cover, backdrop, logo, square art and uploaded reports.
  - `/moderate` has the review queue, hidden items, account blocking and a log of every action.
- **Getting changes onto the site:** with `SITE_DISPATCH_TOKEN` set, each upload or maintainer action asks this repository to rebuild, so the change shows within minutes.

## Discord bot

The Worker also runs the bot that used to be the separate gh-worker. It runs in the `production` environment, with the live database and secrets. The demo runs a test copy; see below.

- **Linked roles:** members link GitHub and get roles by merged pull request count.
- **Slash commands:** `/prs` and `/leaderboard`. Register or update them with `npm --prefix worker run register-commands`, and the linked-role metadata with `register-metadata`. Both need `DISCORD_CLIENT_ID` and `DISCORD_BOT_TOKEN` in the environment.
- **Announcements:** every minute it checks for merges, sorted with the same classifier as `/updates` (`src/lib/merges.ts`), and posts each one as it lands. A linked author is pinged. Other mentions in titles and notes never ping.

| Webhook secret | What goes there |
|---|---|
| `DISCORD_WEBHOOK_PROGRESS` | Features, fixes and speed-ups, coloured by area, with the area, type, size and any game named (falls back to `DISCORD_WEBHOOK_URL`) |
| `DISCORD_WEBHOOK_DEV` | Tests, docs and tooling merges (not posted when unset) |
| `DISCORD_WEBHOOK_RELEASES` | New releases, checked every 5 minutes |
| `DISCORD_WEBHOOK_GAMES` | Games reaching a new stage, from the site's games feed, every 2 minutes |
| `DISCORD_WEBHOOK_DIGEST` | Yesterday's progress summary, once a day from 01:00 UTC (falls back to `DISCORD_WEBHOOK_PROGRESS`) |

- **Keeping the site current:** when the bot sees a user-facing merge, a release or new bring-up reports, it asks this repository to rebuild. Requests are at most every 2 minutes, and one that comes too soon is kept and sent later. GitHub runs one build at a time and keeps only the newest waiting one, so on a busy day the site is rebuilt about every 10 minutes.

### Testing the bot before cutover

The demo runs a test copy of the bot with its own Discord app and its own database (`anyps5-bot-test`). The live gh-worker and its database are never touched. The bot stays off until the demo has a `TOKEN_KEY` secret, and deleting that secret turns it off again. On its first run it only records where things stand, so old merges are never posted.

Set each secret from the repository root with `npx wrangler secret put <NAME> --env=""`, which prompts for the value.

1. **Discord app.** In the [Developer Portal](https://discord.com/developers/applications), create a new application, for example "AnyPS5 (test)".
   - **General Information:** put the Application ID in `DISCORD_CLIENT_ID` and the Public Key in `DISCORD_PUBLIC_KEY`, under the demo's `vars` in `wrangler.jsonc`. Neither is secret.
   - **OAuth2:** copy the Client Secret into `DISCORD_CLIENT_SECRET`, and add the redirect `https://demo.anyps5.gg/discord/callback`.
   - **Bot:** reset the token and copy it into `DISCORD_BOT_TOKEN`.
2. **GitHub OAuth app**, for linking GitHub accounts to roles. Create one in [Developer settings](https://github.com/settings/developers) with the callback `https://demo.anyps5.gg/github/callback`. Its Client ID goes in `GITHUB_CLIENT_ID` and a new client secret in `GITHUB_CLIENT_SECRET`. This is separate from the site's sign-in app.
3. **GitHub token** for reading pull requests: a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with "Public repositories" read-only access, in `GITHUB_TOKEN`.
4. **Private channel and webhooks.** In the Discord server, create a channel such as `#bot-test` and make it private (Edit Channel → Permissions → Private Channel). Then go to Edit Channel → Integrations → Webhooks → New Webhook and copy its URL into `DISCORD_WEBHOOK_URL`. To test every kind of post, put the same URL in `DISCORD_WEBHOOK_PROGRESS`, `DISCORD_WEBHOOK_DEV`, `DISCORD_WEBHOOK_RELEASES`, `DISCORD_WEBHOOK_GAMES` and `DISCORD_WEBHOOK_DIGEST` too, or make a channel for each to match production. Without `DISCORD_WEBHOOK_DEV`, `_RELEASES` or `_GAMES`, those posts are skipped.
5. **Turn it on.** Generate a key with `openssl rand -base64 32` and set it as `TOKEN_KEY`.
6. **Discord endpoints.** These are checked as you save them, so set them after step 5:
   - General Information → Interactions Endpoint URL: `https://demo.anyps5.gg/interactions`
   - General Information → Linked Roles Verification URL: `https://demo.anyps5.gg/linked-role`
7. **Commands and role metadata.** In fish, `read -sx DISCORD_BOT_TOKEN` and `read -x DISCORD_CLIENT_ID` keep the token off screen and out of history. Then run `npm --prefix worker run register-metadata` and `npm --prefix worker run register-commands`.
8. **Add it to the server.** Open `https://discord.com/oauth2/authorize?client_id=<Application ID>&scope=applications.commands`. Then, to keep `/prs` and `/leaderboard` in the test channel, go to Server Settings → Integrations → the app → turn off "All Channels" and add `#bot-test`.
9. **Linked role.** Server Settings → Roles → create a role such as "Contributor (test)" → Links → Add requirement → the test app, for example at least 1 merged pull request. Get it from the server menu → Linked Roles, which takes you through Discord and GitHub sign-in.

What to expect: merges post within a minute or two of landing (upstream merges about 160 a day, so the channel gets busy). A game reaching a new stage posts within about two minutes of the site rebuilding. A release posts within five minutes. The daily summary posts after 01:00 UTC. `npx wrangler tail --env=""` shows the bot's logs. At cutover, the production environment uses the live app and database, and the test app can be deleted.

## Deploying and running

The demo deploys itself from `.github/workflows/site.yml`:
- on every push to `main`
- on a rebuild request from the Worker (`site-data-changed`) or from upstream (`upstream-updated`)
- every 3 hours, only when something the site shows changed (while this repository is private; once it's public, run it hourly)
- daily, regardless

Every deploy first runs the site's and the Worker's tests, and applies the site database's migrations. If the token can't, the deploy asks the running Worker (`/api/schema`) which migrations the database has, and stops if the new code needs one it lacks. `ci.yml` runs the same checks on pull requests.

**Settings and secrets:**

| Name | Where | Needed for |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secrets | Deploying ("Edit Cloudflare Workers" token template, limited to the account and zone, plus "D1: Edit" for database migrations) |
| `SGDB_API_KEY` | GitHub repository secret | SteamGridDB art (optional) |
| `SITE_URL` | GitHub repository variable | The site's address, once it isn't the demo; builds read uploads from it |
| `SITE_GITHUB_CLIENT_ID`, `SITE_GITHUB_CLIENT_SECRET` | Worker secrets | GitHub sign-in (an OAuth app with the callback `https://<site>/auth/github/callback`) |
| `SITE_DISPATCH_TOKEN` | Worker secret | Rebuilds after uploads, moderation and upstream changes (a fine-grained token with "Contents: read and write" on this repository) |
| `MAINTAINERS`, `SITE_REPO` | `wrangler.jsonc` vars | Maintainer account ids; the repository to rebuild |
| Bot secrets | Worker secrets, production | See [Going live](#going-live) |

Set Worker secrets with `npx wrangler secret put <NAME> --env=""` for the demo, or `--env production`.

### Measuring library progress on main

This step runs upstream's own `tools/progress.py`, which only reads source files, and hands its output to `fetch:upstream`. Add it to `.github/workflows/site.yml` before the "Refresh compatibility data" step. If it fails, the build carries on with the published numbers.

```yaml
      - name: Measure library progress on upstream main
        if: steps.seen.outputs.cache-hit != 'true'
        continue-on-error: true
        run: |
          src="$RUNNER_TEMP/upstream-src"
          git clone --quiet --depth 1 --filter=blob:none --sparse "https://github.com/$UPSTREAM" "$src"
          git -C "$src" sparse-checkout set tools core/libs/prx core/shader/recompiler/RdnaDecoder/include
          python3 "$src/tools/progress.py" --json > "$RUNNER_TEMP/progress-main.json"
          echo "UPSTREAM_PROGRESS=$RUNNER_TEMP/progress-main.json" >> "$GITHUB_ENV"
          echo "UPSTREAM_PROGRESS_COMMIT=$(git -C "$src" rev-parse HEAD)" >> "$GITHUB_ENV"
```

### Other ways to deploy

- **By hand:** `npm run deploy:demo`. `scripts/refresh-demo.sh` refreshes every data source first. Since GitHub Actions took over, the systemd timer in `scripts/systemd/` isn't needed; if you do install it, it deploys your local working tree.
- **GitHub Pages:** `.github/workflows/deploy.yml` (manual) publishes the site there, with the library archives copied in rather than proxied. It needs Pages enabled with "GitHub Actions" as the source, the `SITE_URL` variable, and `public/CNAME` for a custom domain. Sign-in, uploads, moderation and the bot need the Worker, so they aren't available there.

## Going live

The production environment in `wrangler.jsonc` is the official site with the bot. It reuses gh-worker's D1 database, so linked members, merge history and the announcement position carry over, and it shares `anyps5-site` with the demo, so uploads carry over too.

1. **Domain:** `wrangler.jsonc` already gives production `anyps5.gg` (`env.production.routes` and `BASE_URL`). Set the repository variable `SITE_URL` to `https://anyps5.gg` so the workflow reads uploads from, and deploys for, the live site.
2. **Sign-in app:** create the real GitHub OAuth app for sign-in (callback `https://anyps5.gg/auth/github/callback`).
3. **Secrets:** run `npx wrangler secret put <NAME> --env production` for each of these:
   - sign-in and rebuilds: `SITE_GITHUB_CLIENT_ID`, `SITE_GITHUB_CLIENT_SECRET`, `SITE_DISPATCH_TOKEN` (new values; regenerate any shared during testing)
   - the bot: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_TOKEN`
   - `TOKEN_KEY`: the **same value** gh-worker uses. Linked members' Discord tokens are encrypted with it; with a new key they would all have to link again.
   - the webhooks from the [bot's table](#discord-bot)
4. **Stop gh-worker's cron** (remove its trigger, or delete that Worker), so the two never post the same merge or refresh the same tokens.
5. **Deploy:** `SITE_URL=https://<domain> npm run deploy:production`. This builds without the demo's `noindex`, applies the site database's migrations and deploys. Then run `npm --prefix worker run migrate:remote` for the bot's database; it does nothing unless new migrations were added.
6. **Discord developer portal:** point these at the new domain:
   - Interactions Endpoint URL: `/interactions`
   - Linked Roles Verification URL: `/linked-role`
   - OAuth2 redirect: `/discord/callback`

   In the bot's GitHub OAuth app, set the callback to `/github/callback`. The slash commands stay registered.
7. **Workflow:** in `.github/workflows/site.yml`, change the deploy step from `npm run deploy:demo` to `npm run deploy:production`, with `SITE_URL` set.

## Languages

The home page, the setup guide and the FAQ exist in English, Spanish, Brazilian Portuguese, Simplified Chinese and Russian, under `/es/`, `/pt-br/`, `/zh-cn/` and `/ru/`. Every other page is English only. The setup guide lives in the docs at `/docs/guide`; old `/guide` links redirect there.

- **Interface text:** in `src/i18n/<locale>.ts`. `en.ts` is the source, and the build fails if a translation is missing a key.
- **Guide steps:** in `src/content/guide/<locale>/`, with the same file names as the English steps. A missing step falls back to English.
- **Links:** inside translated text, links use English paths, and the pages point them at the reader's language where a translation exists.
- **Adding a language:** add it to `src/i18n/locales.ts`, add a strings file, and translate the guide folder.

## Layout

```
src/pages/          routes: home, compatibility, convert, docs and guide, download, progress, updates, report, moderate, feeds
src/components/     page pieces (game cards, art, screenshots, uploads, maintainer tools, header, footer)
src/content/guide/  setup guide, one MDX file per step and language
src/lib/            data loading, parsing, resolution, merges, run reports, uploads, docs, OG images
src/i18n/           interface text per language
scripts/            data sync, upstream fetch, coverage, validation, deploy scripts
worker/             the Cloudflare Worker: library proxy, sign-in, uploads, moderation and the Discord bot, with its own tests
data/games/         curated game files
data/generated/     synced data
docs/proposals/     the run report brief and the replies with the runtime team
```

## Legal

AnyPS5 is not affiliated with Sony Interactive Entertainment. Game art belongs to its publishers and is shown from the PlayStation Store and SteamGridDB. Title names come from [andshrew/PlayStation-Titles](https://github.com/andshrew/PlayStation-Titles).
