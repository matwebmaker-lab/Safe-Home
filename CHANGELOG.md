# Changelog

All notable changes to Safe Home are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Full-screen 3D garage: browse cars, paint, tracks, and upgrades on a live preview
- Coin wallet: earn coins in runs and spend them on cars, paint colors, tracks, turbo, magnet, and shield
- Cars with gameplay perks (extra turbo, built-in magnet, free shield)
- Multiple tracks (Night City, Desert, Winter Road, Sunset) with distinct themes
- Updates section in settings with current version, what’s new, and download progress
- Daily check for new versions (install starts when an adult taps Update)
- Game results screen after crash / wrong answer / miss / bomb: survival time, score, bonus screen time, Play again and Garage
- Fartsbombe mode: bomb health drains when slow and explodes at zero
- Mode select (Normal / Fartsbombe) before each run
- Sticky finish-line math gates (answers hover over lanes, then lock to the line)
- Correct-answer glory and fail/explosion visual effects

### Changed

- Settings uses a sidebar with categories (Time & play, PIN, Windows, App version) instead of one long form
- Parent reward setting is a Small↔Large slider that scales all earned screen time, replacing “seconds per correct answer”

## [0.1.1] - 2026-07-24

### Changed

- Switched to Bun for frontend tooling

## [0.1.0] - 2026-07-01

### Added

- First release of Safe Home (lock screen, PIN, earn-time game, HUD)
