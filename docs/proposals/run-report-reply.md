# Run report: the website's reply

Reply to "Run report: answer for the website". Thanks: the decisions all work for the site, and the changes make the reports more honest. Below: what we're adjusting on our side, five things to settle before the freeze, and two small requests. With those settled, **we agree to freeze version 1**.

## What the site does with your changes

- **Nulls mean unknown.** No null is read as false, zero or "nothing missing". Unknown values show as "unknown" or are left out, and checks that need them are skipped.
- **Stages:** `unknown` contributes no stage. `loads`, `starts`, `first-draw` and `presents` map to the compatibility list's Loads, Starts, First draw and Presents. We'll reword Loads ("reached the game's entry point") and Presents ("the GPU accepted a frame for display") to match your definitions. An upload only moves a game's stage once a second account, or a Discussions report, confirms it, so "presents doesn't prove the frame was visible" is covered.
- **Recovered and incomplete runs** count like any other report and are labelled "recovered" on the game page.
- **`coverage`:** with a section's coverage off, we don't show its list or check it against the source code.
- **`truncated`:** shown as "and N more".
- **`exitCode`, `fpsWindowSeconds`, `cacheHits`, `usage`, and `status` with `accepted`/`rejected`/`unknown`:** all fine.
- **Validation:** we'll copy your `docs/run-report.schema.json` into the website repo and validate uploads against that file directly, in the Worker and in the build, rather than keeping our own copy of the rules. Please stick to JSON Schema draft 2020-12 keywords. We'll use a validator that runs in Cloudflare Workers, where code generation isn't allowed.

## To settle before the freeze

1. **`game.titleId`.** The site can only attach a report to a game through its title ID. Is it ever null in practice, given the runtime reads `param.json`? If it can be, the upload page will ask the person to choose the game, but please make it as reliable as you can.
2. **The unknown-opcode field.** "An unknown numeric opcode keeps its number with a null name" implies a separate number field. Please name it in the schema, for example `opcodeValue: integer | null` next to `opcode: string | null`.
3. **`stop.reason`.** The final list of values.
4. **`usage`.** For image formats and descriptors: a fixed list of values, or free text? A fixed list is better for us, because we group by it.
5. **The shapes of `coverage` and `truncated`.** For example:
   - `coverage: { missing: bool, shaders: bool, imageFormats: bool, descriptors: bool }`
   - `truncated: { functions: int, unsupported: int, imageFormats: int, descriptors: int }`

   Use whatever names you prefer, as long as they're fixed in the schema.

## Two requests

- **A run id** in the report itself (`run.id`), the same one used in `reports/<run id>/`. It lets us spot the same run uploaded twice, even when the file was re-saved.
- **Fixtures in a fixed path**, such as `docs/run-report-fixtures/*.json`, so the website's CI can fetch them and confirm we accept every one.

Optional, if it's cheap: the relinker version or commit the game was converted with. It would help explain runs where the launch flag isn't recognised.

## What happens next on our side

Once the schema is frozen:
1. We copy it in and switch validation over to it.
2. We run your fixtures in our tests.
3. We update the upload page and the game pages for the new fields.

Uploads already work on the site (sign in with GitHub, confirmations, maintainer review), so the runtime can be tested against it as soon as your fork writes reports.
