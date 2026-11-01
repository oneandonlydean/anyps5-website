# Bring-up form: make the build machine-readable

A proposal for `.github/DISCUSSION_TEMPLATE/game-bring-up.yml` upstream.

## Why

The compatibility site now places every report on a release: the release itself, or `main` after it. That gives each game a "by release" history and flags games that got less far on a newer build. Placing a report needs the commit it was built from.

The "AnyPS5 commit" field is free text today. Most reports give a hash, and 154 of 156 distinct hashes resolve upstream. The rest are hard to read:

- 63 of 304 reports have no build at all. Many of these are replies that don't follow the form.
- Base commit, pull requests and local changes are mixed in one line: `main 38d3c0858a with #8847 (12223bf208)`. The site has to guess which hash is the base and whether the build was plain `main`.
- Some say only "main" or "latest", which can only be placed by the date of the post.

## Proposed change

Replace the single `commit` input with three fields:

```yaml
  - type: dropdown
    id: build-kind
    attributes:
      label: AnyPS5 build
      options:
        - A release download
        - main, unchanged
        - main with pull requests on top
        - My own changes
    validations:
      required: true
  - type: input
    id: commit
    attributes:
      label: Commit or release
      description: The commit hash `main` was built at (`git rev-parse --short HEAD`), or the release tag.
      placeholder: 44a59edc3a or v0.1.4
    validations:
      required: true
  - type: input
    id: prs
    attributes:
      label: Pull requests on top
      description: Numbers of any pull requests merged in locally, or leave empty.
      placeholder: "#8847, #9012"
```

Optional additions in the same pass:

- **Furthest point:** add `Playable from start to finish`. The site already has that stage, but it can only come from a maintainer today.
- **System tested:** split the OS and the GPU vendor into dropdowns (Linux, Windows, macOS; AMD, NVIDIA, Intel, Apple), and keep the free-text field for the model and driver.

## Effect on the site

The parser (`src/lib/parse.ts`) would read the new fields directly, and still read the old single field for existing threads. Nothing breaks for threads written before the change.
