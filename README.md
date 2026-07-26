# Safe Home (Tauri)

A custom replacement for Windows’ built-in Family Safety screen-time lock
(“Time’s up!”), built with Tauri using the ZeBeyond reference design
(dark background, grid, green glow, mint/cyan gradient button).

On first launch, an adult must configure a PIN, seconds per math item, and
other screen-time settings. Alt+F4 and the Start menu are blocked while the
lock screen is visible.

**Language:** The app UI defaults to English. Norwegian can be selected in
Settings. Release notes and documentation are always written in English.

## Features

- **Switch user or shut down PC** — the original button, opens a small menu
  with “Switch user” (locks the workstation) and “Shut down PC” (powers off
  the machine immediately).
- **Get more time** — an adult enters their PIN to grant extra time today.
- **Drive to earn time** — the device user can play a 3D car game (endless
  runner built with Three.js) to earn time themselves, with realistic night
  driving graphics: real car silhouette with glossy paint, windows, front and
  rear lights (headlights actually light the road), procedural asphalt,
  guardrails, street lights, trees, gradient sky with stars, shadows, and
  striped traffic barriers — without asking an adult: drive forward, change
  lane with the arrow keys (or A/D, or swipe on touch), collect coins, and
  avoid the red obstacles. Each coin grants seconds (default 20, adjustable),
  and a streak of 5+ coins without crashing gives +25% bonus, 10+ gives +50%.
  Crashing costs no earned time — only the streak resets and the car slows
  briefly. When they feel they’ve earned enough (at least 60 seconds), they
  tap “Done – use the time”. Daily earn limit: default 90 min/day, changed in
  settings — 0 means no limit. The game also has math questions, a shop, car
  upgrades, and multiple maps — see the section below.
- **Corner box** — when the device is unlocked (via adult PIN or earned time),
  the window shrinks to a small floating box in the top-right that shows
  remaining time live. When time runs out, the window grows back to the full
  lock screen. **Ctrl+Shift+H** (or another shortcut you choose under Settings)
  shows or hides the box anytime while unlocked. The gear in the box opens
  settings (PIN-protected).
- **Settings** — the gear in the top-right is PIN-protected and lets an adult
  change: PIN, unlock-time text, how many minutes “Get more time” grants, how
  many seconds each game hit grants, daily earn limit, Windows autostart, and
  the shortcut to show/hide the time box.
- **PIN on uninstall** — the NSIS uninstaller requires the same adult PIN as
  in the app before Safe Home can be removed (automatic updates skip the PIN
  check).
- **Watchdog service** — a Windows service restarts Safe Home if the main
  process is closed (for example from Task Manager). Install while logged into
  the account that should be locked; approve the one-time administrator prompt.
  The service is machine-wide, but it only relaunches the lock screen for that
  designated user.

The default PIN is **1234** — change it in the in-app settings panel anytime.

## New in the car game: math, shop, upgrades, and maps

The car game has four new systems. Everything is pure frontend (no Rust
backend changes), and all content is still 100% procedural — no external
models or texture files.

### Math questions (multiplication)

Every 7th wave (`QUESTION_EVERY` in `car-runner.js`) becomes a question round
instead of a normal wave:

- A multiplication question `a × b` is generated where both factors are 1–10
  (e.g. “3 × 5 = ?”). The question is shown in a banner at the top of the
  game HUD (`#car-hud-question`) via the `onQuestion` callback.
- Three sign gates spawn — one per lane — with numbers drawn on
  `CanvasTexture` (same technique as the asphalt/stripe textures). One sign
  has the correct answer; the other two have plausible wrong answers
  (`a·(b±1)`, `(a±1)·b`, `±a`, `±b`, etc. — always unique and positive).
- Driving through the correct sign: +3 bonus coins and the streak increases,
  with a green flash on the car. Wrong sign: streak resets and the car slows
  (same slowdown as obstacles), with a red flash.
- Sign textures are cached per number to avoid rebuilding textures in long
  sessions.

### Wallet and storage (`src/game/profile.js`)

- Coins still grant screen time as before, but each coin is also added to a
  **persistent wallet** used in the shop.
- The profile is stored in `localStorage` under the key
  `safe-home-car-profile` (works in both the Tauri webview and browser
  preview) and contains: `coins`, `upgrades` (level per id), `ownedPaints`,
  `ownedMaps`, `selectedPaint`, `selectedMap`.
- API: `loadProfile()`, `saveProfile()`, `addCoins(profile, n)`,
  `purchase(profile, price)` (deducts the price if affordable, returns
  true/false). Corrupt/missing storage falls back to the default profile.

### Shop and garage (`src/game/shop-data.js` + `#shop-panel`)

A new “Shop and garage” button in the game panel opens a shop with three
sections (rendered dynamically from `main.js`):

- **Upgrades** (level-based):
  - `turbo` Turbo engine — 3 levels (30/60/100 coins), +10% top speed and
    acceleration per level.
  - `magnet` Coin magnet — 2 levels (40/80), pulls coins in the adjacent
    lane toward the car (level 2 has longer range and stronger pull).
  - `skjold` Shield — 25 coins, survives one collision without losing the
    streak (cyan ring around the car while active; consumed and can be
    bought again).
- **Paint** — 6 colors: mint (free), red/blue (20), purple (30), white (40),
  gold (50).
- **Maps** — 4 with distinct themes: Night City (free, the original look),
  Desert (75, day/sand/cacti), Winter Road (100, snow/snow trees), Sunset
  (150, orange-purple sky/palms).

### Map themes

Each map is a `theme` object in `shop-data.js` (sky gradient, fog, ground
color, lights, star opacity, scenery variant: `tre`/`snøtre`/`kaktus`/`palme`)
passed to `createCarRunner()`. `DEFAULT_THEME` in `car-runner.js` is Night
City and should look exactly like the old version. When the player changes
map/paint/upgrade in the shop, the runner is recreated (`dispose()` +
`createCarRunner()`) on the next game start — there is no runtime theme
swap.

### Extended callbacks in `createCarRunner(canvas, options)`

New options: `paint` (hex paint color), `upgrades` (`{turbo, magnet, skjold}`
levels), `theme` (map object), `onQuestion(questionOrNull)`, `onCoinCollect()`
(called per coin, including bonus coins), `onShieldUsed()` (shield was
consumed — `main.js` then resets `upgrades.skjold` in the profile). Existing
API (`start/stop/pause/resume/dispose/setSecondsPerCoin`,
`onEarn/onComboBreak/onStatsUpdate`) is unchanged.


## Preview without building Rust

The frontend is now ES modules (because of the Three.js import), so you can
**no longer** double-click `index.html` directly — it must be served over HTTP:

```bash
bun run preview
```

Then open http://localhost:3456 to test everything — the car game, menu, PIN
flow, settings, and HUD box — without Rust/Tauri. `main.js` simulates Tauri
calls locally (PIN is `1234`). In preview, the HUD box is a small fixed box
in the page corner; in the real app the window itself is ~312×64px and
transparent around the box.

## Prerequisites for the real app

- [Bun](https://bun.sh)
- [Rust](https://www.rust-lang.org/tools/install) + `cargo`
- Tauri’s Windows system dependencies (Microsoft Visual C++ Build Tools +
  WebView2 — WebView2 usually ships with Windows 10/11)

## Run the app in development mode

```bash
bun install
bun run dev
```

## Build an installable .exe locally

```bash
bun run build
```

For update signatures to be generated locally you need
`TAURI_SIGNING_PRIVATE_KEY` (see below).

Optionally add custom icons before building a release installer:

```bash
bunx --bun @tauri-apps/cli icon path/to/your-logo.png
```

## Release via GitHub Actions

GitHub builds the Windows installer, publishes a Release, and uploads
`latest.json` that the app uses for automatic updates.

### New version (recommended)

1. Fill in **`CHANGELOG.md` → `## [Unreleased]`** with what’s new
   (English, short, user-facing). An empty Unreleased section stops the release.
2. Go to **Actions → Release → Run workflow**
3. Choose bump type:
   - **patch** — `0.1.0` → `0.1.1` (small fixes)
   - **minor** — `0.1.0` → `0.2.0` (new features)
   - **major** — `0.1.0` → `1.0.0` (breaking changes)
4. The workflow bumps the version in `package.json`, `Cargo.toml`, and
   `tauri.conf.json`, moves Unreleased to `## [X.Y.Z]`, creates tag
   `vX.Y.Z`, builds the NSIS installer, and publishes the release with notes
   from CHANGELOG (also shown in the app under Settings).

### Manual tag

```bash
# Ensure CHANGELOG.md has content under [Unreleased] first
bun run bump -- patch   # or minor / major
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: bump version"
git tag "v$(bun -e "console.log(require('./package.json').version)")"
git push origin main --tags
```

### Secrets (already set for this repo)

| Secret | Description |
|--------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Private key for signing updates |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Optional password (empty if the key has none) |

The private key lives locally at `%USERPROFILE%\.tauri\safe-home.key`.
**Never lose this** — without it, new updates cannot be signed for users who
already have the app.

## Automatic updates

Installed clients check
`https://github.com/matwebmaker-lab/Safe-Home/releases/latest/download/latest.json`
about **once per day** (on startup, then every hour if more than 24 hours have
passed). If a newer signed version exists, the lock screen prompts with what’s
new and **Update now** / **Not now** (PIN required to install). The same info
is also under **Settings → App version**. Download and install run inside the
app (quiet NSIS — no separate installer wizard), then the app restarts.

- Works only in **release builds** (not `tauri dev`).
- Release notes are taken from `CHANGELOG.md` (the version section) and put in
  the GitHub Release / updater `notes`, which the app shows in the prompt and
  in settings.
- Users with an older install *without* the updater must install once manually
  from GitHub Releases; after that, the rest is automatic.

## How data is stored

The app stores two small JSON files in:

```
%APPDATA%\no.familie.safehome\
├── config.json   PIN hash, unlock text, minutes/seconds, daily limit
└── state.json    remaining time right now + earned today
```

All of this is easiest to set via the in-app settings panel (the gear).
`config.json` is created automatically with defaults the first time the app
runs, and can also be edited by hand if desired.

## PIN on uninstall

The NSIS uninstaller asks for the **same PIN** as in the app before Safe Home
can be removed (up to three attempts). Automatic updates use `/UPDATE` and skip
the PIN check, so updates work as before.

- Applies to the NSIS installer (`.exe` from Releases) — that is the only
  install form that is built.
- The installer requires **administrator** once (per-machine install under
  Program Files) so it can register the watchdog Windows service.
- Silent uninstall (`/S`) without `/UPDATE` is aborted so the PIN cannot be
  skipped.
- If no PIN is set yet (first-run setup not completed), the app can be
  uninstalled without a PIN.
- This is an extra barrier — a user with administrator rights can still bypass
  it other ways. Give the child a **standard user** account (not
  administrator) for best protection.

## Watchdog service

Safe Home installs a Windows service named **Safe Home Watchdog**
(`SafeHomeWatchdog`). It runs as LocalSystem and checks about twice per second
whether the main app is running. If it disappears (for example after Task
Manager), the service marks a tamper flag and starts Safe Home again in the
designated user’s session within about half a second.

- **Install while logged into the locked account** (typically the child’s),
  then approve the administrator UAC prompt. The installer records that user’s
  SID in `%ProgramData%\Safe Home\watchdog.json`.
- Other Windows accounts on the PC are not auto-locked by the service.
- Updates and uninstall pause or remove the service so it does not fight
  intentional exits.
- A child on a standard (non-admin) account generally cannot stop the service.
- If Safe Home **or** the watchdog is killed, remaining screen time is cleared
  and the lock screen requires the adult PIN before the PC can be used again.
- The Windows key (and Ctrl+Esc) are blocked only on the lock screen when
  screen time has run out — not while time remains (idle or HUD).

## What this app deliberately does *not* do

To keep the scope honest and manageable, this is the lock screen, its buttons,
the earn-time game, and the HUD box — not a full parental-control platform:

- It does **not automatically watch the clock** for when to show the first
  time — you decide when the app starts (e.g. at Windows startup, or triggered
  from another script). Once it is shown and a period of time runs out, it
  handles switching between locked and HUD mode itself.
- It does **not block** Alt+Tab, Task Manager, or other OS-level ways to leave
  the window — ending the process in Task Manager is temporary because the
  watchdog service starts Safe Home again and clears screen time (PIN required).
  A user with administrator rights can still stop the service, but Safe Home
  then locks immediately if it is still running. Full kiosk lockdown is outside
  this project’s scope.
- The game requires WebGL (WebView2 on Windows 10/11 supports this). If WebGL
  is missing, a clear error is shown instead of the game.
- Graphics self-tune: if the machine stays under ~24 fps for the first few
  seconds, shadows, headlight casting, and scenery are turned off
  automatically. You can also force low graphics with `?lowgfx` in the URL
  (most useful in browser preview). Game speed is independent of frame rate,
  so it runs at the right pace on slow machines too.
- Earned time is reported by the frontend to the Rust backend. It is not
  hardened against a technically skilled user editing JavaScript via developer
  tools — but Tauri production builds normally do not expose developer tools.
- The daily earn limit resets at UTC midnight, not necessarily local midnight.

## Folder structure

```
safe-home/
├── .github/workflows/     GitHub Actions (release + version bump)
├── .cursor/skills/        Project skills (release notes)
├── CHANGELOG.md           Release notes (shown in the app)
├── scripts/
│   ├── bump-version.mjs
│   └── extract-changelog.mjs
├── src/                   Frontend (HTML/CSS/JS ES modules, no bundler)
│   ├── index.html          Locked view + HUD view + all panels
│   ├── styles.css
│   ├── main.js             App logic (ES module)
│   ├── game/car-runner.js  3D car game (Three.js endless runner with math,
│   │                         upgrades, and map themes)
│   ├── game/profile.js     Wallet + owned items, stored in localStorage
│   ├── game/shop-data.js   Shop data: upgrades, paints, and map themes
│   └── vendor/             three.module.min.js + three.core.min.js (offline)
├── src-tauri/              Rust backend
│   ├── src/main.rs         Commands, window switching, background thread, auto-update
│   ├── src/bin/            Windows watchdog service binary
│   ├── src/watchdog_ctl.rs Pause/resume helpers for the watchdog
│   ├── Cargo.toml
│   ├── tauri.conf.json     Window + updater endpoint
│   ├── windows/            NSIS hooks, PIN check, watchdog register/unregister
│   └── capabilities/
└── package.json
```

## One thing to note

The Rust code was written by hand and could not be compiled in the environment
where it was created (no `cargo`/Windows target available there), so run
`bun run dev` and report any compile errors you hit. The frontend
(HTML/CSS/JS) has been fully tested and verified in the browser — all
buttons, the game, settings, and HUD transitions work as described.
