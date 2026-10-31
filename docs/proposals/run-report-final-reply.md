# Run report: the website accepts version 1

Reply to "Run report: final answers for the website". Thanks: every point is settled and nothing more is needed from you. **Version 1 is frozen on our side too. Please go ahead and finish the build.**

## What the website has done

- **Your schema, unchanged.** `docs/run-report.schema.json` from commit `ca194ef6d16ec5bbac957723aafcd143c1a74c34` is copied word for word into the website repo. Uploads are validated against it in the Cloudflare Worker, and again in the site build.
- **Your fixtures are our tests.** All 11 files in `docs/run-report-fixtures/` pass validation and our extra checks. A test also confirms they cover all seven stop kinds.
- **The byte limit is checked first.** A file over 65,536 bytes is refused before it is parsed.
- **The checks the schema can't express,** as you listed: milestone order, `stage` matching the furthest milestone, and `averageFps` matching frames over the window. A report that fails any of these is refused. So is one dated in the future or more than 180 days old.
- **Checks against upstream.** These don't refuse a report, but hold it back until a maintainer reviews it:
  - it lists a missing function that is implemented upstream
  - it lists an unsupported instruction the recompiler translates
  - `anyps5.modified` is true

  A list whose coverage flag is off is never read as "nothing missing".
- **`run.id`.** A second upload of the same run id is refused, even if the file was re-saved.
- **`game.titleId: null`.** The upload page asks the person to choose the game from the compatibility list. The game page labels that report "Game chosen by uploader".
- **`stop.kind` and `stop.reason`.** Each report on a game page says what stopped the run and how it ended, for example "Stopped on a missing function, AnyPS5 stopped it". Recovered runs are labelled.
- **Stages.** `unknown` counts toward no stage. An upload only moves a game's stage once a second GitHub account confirms it, or a Discussions report by someone else does.
- **The relinker version:** leaving it out of version 1 is fine. If you add an optional `anyps5.relinker` later, send us the new schema's commit and we'll copy it in. The objects are closed, so the site will refuse reports that carry the new field until then.

## Testing end to end

Uploads are live on the demo site now:

1. Run a game with your branch's build, so it writes `anyps5-report.json`.
2. Open https://demo.anyps5.gg/report, sign in with GitHub, and upload the file.
3. The preview shows what was read from the file. A refused file shows up to five reasons, each with the path of the field.

Treat what you upload to the demo as test data: it may be cleared before the site goes live. Two uploads from the same GitHub account only count as one confirmation.

## One optional suggestion

When a run ends, it would help testers if the runtime printed where the report was written and pointed them at the site's upload page. The site will move to a new domain at launch, so please don't hard-code the demo address. A line in the docs is enough for now.

## When it lands upstream

Please tell us when the schema is merged into upstream's main. We'll pin our copy to that commit instead of your branch's.
