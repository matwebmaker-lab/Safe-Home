# Safe Home (Tauri)

A custom replacement for Windows’ built-in Family Safety screen-time lock
(“Time’s up!”), built with Tauri. Dark lock screen with the Safe Home logo,
grid background, and mint/cyan accent controls.

On first launch, an adult configures a PIN, reward size, grant minutes, daily
earn limit, unlock-time text, and Windows autostart. Alt+F4 and the Start menu
are blocked while the lock screen is visible.

**Language:** The app UI is Norwegian. Release notes and this documentation are
written in English.

## Features

- **Switch user or shut down PC** — opens a small menu with “Switch user”
  (locks the workstation) and “Shut down PC” (powers off immediately).
- **Get more time** — an adult enters their PIN to grant extra time today
  (default 30 minutes, adjustable in settings).
- **Drive to earn time** — the device user plays a 3D endless car runner
  (Three.js) to earn screen time without asking an adult. Drive forward, change
  lane (arrow keys / A·D / swipe), collect coins, answer multiplication gates,
  and avoid traffic. Each coin and correct answer grants screen time scaled by
  the parent **reward size** setting. A streak of 5+ coins without crashing
  gives +25% bonus, 10+ gives +50%. Crashing costs no earned time — only the
  streak resets and the car slows briefly. When they have earned at least
  60 seconds, they tap **Ferdig – bruk tiden**. Daily earn limit defaults to
  90 min/day (0 = no limit). See **Car game** below for garage, modes, and
  upgrades.
- **Corner box (HUD)** — when unlocked (adult PIN or earned time), the window
  shrinks to a floating box that shows remaining time live. Drag to move it.
  When time runs out, the full lock screen returns. **Ctrl+Shift+H** (or
  another shortcut under Settings → Windows) shows or hides the box while
  unlocked. The gear opens PIN-protected settings; the play button opens the
  earn-time game.
- **Settings** — PIN-protected sidebar with categories:
  - **Tid og spill** — unlock-time text, grant minutes, reward size
    (Small↔Large slider that scales all earned screen time), daily earn limit
  - **PIN-kode** — change the adult PIN
  - **Windows** — autostart, HUD show/hide hotkey
  - **App-versjon** — current version, what’s new, update download/install
- **Automatic updates** — release builds check for a newer signed version about
  once per day. The lock screen can prompt with release notes; install runs
  quietly inside the app (PIN required), then restarts.
- **PIN on uninstall** — the NSIS uninstaller requires the same adult PIN
  before Safe Home can be removed (automatic updates skip the PIN check).
- **Watchdog service** — a Windows service restarts Safe Home if the main
  process is closed (for example from Task Manager). It also restores the
  lock binary from a sealed copy if someone deletes it from Program Files.
  Install while logged into the account that should be locked; approve the
  one-time administrator prompt. The service is machine-wide, but it only
  relaunches the lock screen for that designated user. Ending Safe Home or
  the watchdog while time remains clears remaining time and requires the
  adult PIN again.

On first run there is no default PIN — the setup wizard requires an adult to
choose one (4–8 digits). In browser preview (`bun run preview`), the simulated
PIN is **1234**.

## Car game

### Modes

Before each run, choose a mode:

- **Normal** — math gates and traffic; best survival time is tracked.
- **Fartsbombe** — bomb health drains when you drive slowly and regenerates
  when you keep speed up; at zero the bomb explodes and the run ends.

After crash, wrong answer, miss, or bomb, a results screen shows survival time,
score, coins, and bonus screen time, with **Spill igjen** and **Garasje**.

### Math questions

Every 2nd wave is a question round. A multiplication `a × b` (factors 1–10)
appears on a road plate above the lanes. Answer signs lock to a finish line —
drive through the correct lane. Correct: bonus coins, streak up, glory effect.
Wrong or miss: run ends (results screen).

### Garage, wallet, and upgrades

**Garasje** opens a full-screen 3D garage with a live car preview, lobby music
(mute/unmute), and a large wallet / earned-time strip (with coin-fly and time
count-up animations).

Coins from runs go into a **persistent wallet** (`localStorage` key
`safe-home-car-profile`) used in the shop, and still grant screen time as
usual. The profile stores coins, upgrades, owned cars/paints/maps, selection,
last mode, and best survival times.

Shop contents (`src/game/shop-data.js`):

- **Cars** — several body styles with perks (extra turbo, built-in magnet,
  free shield per run). Standard is free; others cost coins.
- **Upgrades** — Turbo (3 levels), Coin magnet (2 levels), Shield (one-hit,
  consumable).
- **Paint** — mint (free) plus red, blue, purple, white, gold.
- **Maps** — Night City (free), Desert, Winter Road, Sunset — each with its
  own sky, fog, ground, and scenery (trees / cacti / palms / snow trees).

Models are procedural Three.js groups in `src/3dassets/models.js` (no external
GLTF/texture files). Graphics self-tune on slow machines; force low graphics
with `?lowgfx` in browser preview.

## Preview without building Rust

The frontend uses ES modules, so it must be served over HTTP:

```bash
bun run preview
```

Open http://localhost:3456 to try the lock screen, PIN flow, settings, garage,
game, and HUD without Rust/Tauri. `main.js` simulates Tauri calls (PIN
`1234`). In preview the HUD is a fixed box in the page corner; in the real app
the window itself is small and transparent around the box.

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
   from CHANGELOG (also shown in the app under Settings → App-versjon).

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
is also under **Settings → App-versjon**. Download and install run inside the
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
├── config.json   PIN hash (salted), unlock text, reward scale, grant minutes, daily limit, hotkey, autostart
└── state.json    remaining time right now + earned today
```

The PIN itself is never stored. At install the setup writes a **random 32-byte salt**
to a **random path under `%ProgramData%`** (opaque folder + file names). Only a
pointer (`salt_path`) is kept in `%ProgramData%\Safe Home\watchdog.json`. The
stored value is `SHA-256` over a fixed label, the salt, and the PIN — not a
source-code salt and not a plain hash of the digits alone.

A durable backup of `config.json` is also kept under ProgramData:

```
%ProgramData%\Safe Home\
├── config.pending.json   staging copy written by the app
└── config.seal           hardened backup (Users can read, not change/delete)
```

The watchdog copies pending → `config.seal` and tightens the ACL. If someone
deletes or empties the AppData `config.json` after setup, Safe Home restores
the PIN and settings from the seal, clears remaining screen time, and shows the
lock screen so a parent must enter the PIN again — it does **not** reopen the
first-run setup wizard.

Game progress (wallet, cars, paints, maps, upgrades, best times) lives in the
WebView `localStorage` under `safe-home-car-profile`.

All of this is easiest to set via the in-app settings panel (the gear).
`config.json` is created automatically with defaults the first time the app
runs.

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
- If AppData `config.json` was deleted, the uninstaller still checks the
  ProgramData seal / pending backup for the PIN hash.
- This is an extra barrier — a user with administrator rights can still bypass
  it other ways. Give the child a **standard user** account (not
  administrator) for best protection.

## Watchdog service

Safe Home installs a Windows service named **Safe Home Watchdog**
(`SafeHomeWatchdog`). It runs as LocalSystem and checks about twice per second
whether the lock UI process is running. If it disappears (for example after Task
Manager), the service marks a tamper flag and starts Safe Home again in the
designated user’s session within about half a second. The watchdog process
itself is also restarted quickly if killed.

**Binaries**

| File | Role |
|------|------|
| `safe-home.exe` | Thin launcher (Start Menu / desktop). Starts the host and exits. |
| `sh-host.exe` | Real lock UI — this is what the watchdog monitors and relaunches. |
| `safe-home-watchdog.exe` | Windows service binary |

If `sh-host.exe` or `safe-home.exe` is deleted from Program Files, the service
copies it back from `%ProgramData%\Safe Home\payload\` (written at install /
update, ACL’d to SYSTEM + Administrators), marks tamper, and relaunches.

- **Install while logged into the locked account** (typically the child’s),
  then approve the administrator UAC prompt. The installer records that user’s
  SID in `%ProgramData%\Safe Home\watchdog.json`, and creates a per-machine PIN
  salt at a random path under `%ProgramData%` (pointer stored as `salt_path`).
- Other Windows accounts on the PC are not auto-locked by the service.
- Updates and uninstall pause or remove the service so it does not fight
  intentional exits.
- A child on a standard (non-admin) account generally cannot stop the service
  or wipe the sealed restore copies.
- If Safe Home **or** the watchdog is killed, remaining screen time is cleared
  and the lock screen requires the adult PIN before the PC can be used again.
- If AppData settings (`config.json`) are deleted after setup, they are restored
  from the ProgramData seal and the lock screen requires the adult PIN again.
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
│   ├── index.html         Locked view + HUD + panels + garage shell
│   ├── styles.css
│   ├── main.js            App logic (ES module)
│   ├── logo.png
│   ├── 3dassets/
│   │   └── models.js      Procedural car / traffic / scenery models
│   ├── game/
│   │   ├── car-runner.js  3D endless runner (math gates, modes, themes)
│   │   ├── garage-scene.js Live 3D garage preview
│   │   ├── garage-icons.js Shop card icons
│   │   ├── lobby-music.js Garage lobby music
│   │   ├── profile.js     Wallet + owned items (localStorage)
│   │   ├── shop-data.js   Cars, upgrades, paints, map themes
│   │   ├── effects.js     Glory / fail / explosion VFX
│   │   └── stat-fx.js     Coin-fly and time count-up animations
│   └── vendor/            three.js + postprocessing (offline)
├── src-tauri/             Rust backend
│   ├── src/main.rs        Commands, window switching, timer, auto-update
│   ├── src/bin/           Watchdog service + thin safe-home.exe launcher
│   ├── src/watchdog_ctl.rs Pause/resume + tamper + sealed payload helpers
│   ├── Cargo.toml
│   ├── tauri.conf.json    Window + updater endpoint
│   ├── windows/           NSIS hooks, PIN check, watchdog register/unregister
│   └── capabilities/
└── package.json
```
