---
name: safe-home-release
description: >-
  Prepare Safe Home release notes and version bumps. Use when tagging a new
  Safe Home version, writing CHANGELOG entries, running a GitHub Release
  workflow, or documenting what is new for in-app update notes.
---

# Safe Home release notes

When releasing or tagging a new Safe Home version, keep `CHANGELOG.md` as the
single source of truth for “what’s new”. GitHub Releases and the in-app updater
both surface that text.

**Language:** Write all release notes and documentation in **English** (the
app’s default language). Norwegian is an optional in-app UI language only —
not for CHANGELOG, README, or GitHub release bodies.

## Before every release

1. Edit `CHANGELOG.md` under `## [Unreleased]`.
2. Use Keep a Changelog groups: `Added`, `Changed`, `Fixed`, `Removed`.
3. Write short, user-facing bullets in English.
4. Do **not** invent a version heading yet — `scripts/bump-version.mjs` promotes
   `[Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` when the version is bumped.

Example:

```markdown
## [Unreleased]

### Added

- Update button in settings with a progress indicator

### Fixed

- HUD stayed visible after time ran out
```

## How a release is cut

Preferred path:

1. Ensure `[Unreleased]` has real notes (non-empty).
2. GitHub Actions → **Release** → Run workflow → choose `patch` / `minor` / `major`.
3. Workflow runs `bun scripts/bump-version.mjs`, which:
   - bumps `package.json`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`
   - moves `[Unreleased]` notes into the new version section
4. Publish job runs `bun scripts/extract-changelog.mjs <version>` and uses the
   output as the GitHub release body (also fed into updater `notes` / `body`).

Manual tag path (`git tag vX.Y.Z`): still require a matching `## [X.Y.Z]` section
in `CHANGELOG.md` before tagging, or `extract-changelog.mjs` fails the release.

## Verify notes locally

```bash
bun scripts/extract-changelog.mjs
# or
bun scripts/extract-changelog.mjs 0.2.0
```

## In-app behavior (do not regress)

- App checks for updates about once per day (release builds only).
- Settings → **App version** shows current version, notes for a newer release,
  **Update now**, and a download progress bar when the user starts the install.
- Do not reintroduce silent auto-install on startup; adults confirm in settings.
