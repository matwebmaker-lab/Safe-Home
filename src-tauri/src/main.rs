// Skjuler ekstra konsoll-vindu på Windows i release-bygg
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

/// Innstillinger en voksen kan endre fra appens eget innstillingspanel
/// (PIN-beskyttet), lagres i AppData/config.json.
#[derive(Serialize, Deserialize, Clone)]
struct Config {
    pin_hash: String,
    unlock_time: String,
    grant_minutes: u32,
    seconds_per_hit: u32,
    max_earn_minutes_per_day: u32,
    #[serde(default)]
    autostart: bool,
}

impl Default for Config {
    fn default() -> Self {
        // Standard-PIN er "1234". Kan endres i appens innstillingspanel.
        Config {
            pin_hash: hash_pin("1234"),
            unlock_time: "07:00".to_string(),
            grant_minutes: 30,
            seconds_per_hit: 20,
            max_earn_minutes_per_day: 90,
            autostart: false,
        }
    }
}

/// Vis HUD-piller når det er så lite tid igjen (eller mindre).
/// Over dette skjules vinduet helt, så det ikke ligger over Steam/spill.
const HUD_SHOW_BELOW_SECS: u64 = 5 * 60;

#[derive(Clone, Copy, PartialEq, Eq)]
enum UiMode {
    Locked,
    /// Opplåst med god tid — vinduet er skjult
    Idle,
    /// Lite tid igjen — liten flyttbar pille
    Hud,
}

/// Kjøretidstilstand (hvor lenge skjermen er låst opp, og hvor mye tid
/// som er opptjent gjennom spillet i dag) — lagres separat fra
/// innstillingene i AppData/state.json, slik at den kan nullstilles
/// uten å miste PIN/innstillinger.
#[derive(Serialize, Deserialize, Default, Clone)]
struct RuntimeState {
    unlocked_until: u64,
    earned_today_minutes: u32,
    earned_day_index: u64,
    /// Sist lagrede HUD-posisjon (logiske piksler). None = standard øvre høyre.
    #[serde(default)]
    hud_x: Option<f64>,
    #[serde(default)]
    hud_y: Option<f64>,
}

struct AppState {
    config: Mutex<Config>,
    unlocked_until: Mutex<u64>,
    earned_today_minutes: Mutex<u32>,
    earned_day_index: Mutex<u64>,
    ui_mode: Mutex<UiMode>,
    hud_x: Mutex<Option<f64>>,
    hud_y: Mutex<Option<f64>>,
    /// Bruker har hentet frem HUD med Ctrl+Win (selv om det er god tid igjen).
    hud_manual_show: Mutex<bool>,
}

fn hash_pin(pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Grov "dag-indeks" for å nullstille daglig spilletid. Basert på UTC,
/// så dagsskiftet er ikke nødvendigvis midnatt lokal tid — enkelt og
/// robust fremfor helt presist.
fn today_index() -> u64 {
    now_secs() / 86400
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("fant ikke config-mappen for appen");
    fs::create_dir_all(&dir).ok();
    dir
}

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("config.json")
}

fn state_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("state.json")
}

fn load_config(app: &tauri::AppHandle) -> Config {
    let path = config_path(app);
    if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<Config>(&data) {
            // Synk Windows-autostart med lagret innstilling
            let _ = set_windows_autostart(cfg.autostart);
            return cfg;
        }
    }
    let cfg = Config::default();
    let _ = fs::write(&path, serde_json::to_string_pretty(&cfg).unwrap_or_default());
    cfg
}

const AUTOSTART_VALUE_NAME: &str = "Skjermtid";

/// Aktiver/deaktiver start ved Windows-pålogging via HKCU Run-nøkkelen.
fn set_windows_autostart(enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_path = exe.to_string_lossy().replace('/', "\\");
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    #[cfg(windows)]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    if enabled {
        let mut cmd = Command::new("reg");
        cmd.args([
            "add",
            key,
            "/v",
            AUTOSTART_VALUE_NAME,
            "/t",
            "REG_SZ",
            "/d",
            &format!("\"{}\"", exe_path),
            "/f",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let status = cmd.status().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Klarte ikke å aktivere Windows-oppstart.".into());
        }
    } else {
        let mut cmd = Command::new("reg");
        cmd.args(["delete", key, "/v", AUTOSTART_VALUE_NAME, "/f"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let _ = cmd.status();
    }
    Ok(())
}

fn is_windows_autostart_enabled() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                AUTOSTART_VALUE_NAME,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        matches!(output, Ok(s) if s.success())
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn save_config(app: &tauri::AppHandle, cfg: &Config) {
    let _ = fs::write(
        config_path(app),
        serde_json::to_string_pretty(cfg).unwrap_or_default(),
    );
}

fn load_runtime_state(app: &tauri::AppHandle) -> RuntimeState {
    fs::read_to_string(state_path(app))
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default()
}

fn save_runtime_state(app: &tauri::AppHandle, s: &RuntimeState) {
    let _ = fs::write(
        state_path(app),
        serde_json::to_string_pretty(s).unwrap_or_default(),
    );
}

/// Bytter vinduet til fullskjerms låseskjerm.
fn enter_locked_mode(app: &tauri::AppHandle, win: &tauri::WebviewWindow) {
    *app.state::<AppState>().ui_mode.lock().unwrap() = UiMode::Locked;
    let _ = win.set_fullscreen(false);
    let _ = win.set_decorations(false);
    let _ = win.set_always_on_top(true);
    if let Ok(Some(monitor)) = win.current_monitor() {
        let scale = monitor.scale_factor();
        let screen = monitor.size().to_logical::<f64>(scale);
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            screen.width.max(800.0),
            screen.height.max(600.0),
        )));
        let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(0.0, 0.0)));
    } else {
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1280.0, 800.0)));
        let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(0.0, 0.0)));
    }
    let _ = win.set_fullscreen(true);
    let _ = win.show();
    let _ = win.set_focus();
}

/// Opplåst med god tid igjen: skjul vinduet helt (ikke over Steam).
fn enter_unlocked_idle(app: &tauri::AppHandle, win: &tauri::WebviewWindow) {
    let state = app.state::<AppState>();
    let prev = *state.ui_mode.lock().unwrap();
    if prev == UiMode::Idle {
        return;
    }
    // Ta vare på pillens posisjon før den skjules
    if prev == UiMode::Hud {
        if let Ok(pos) = win.outer_position() {
            let scale = win.scale_factor().unwrap_or(1.0);
            let logical = pos.to_logical::<f64>(scale);
            *state.hud_x.lock().unwrap() = Some(logical.x);
            *state.hud_y.lock().unwrap() = Some(logical.y);
        }
        save_runtime_state(app, &snapshot_runtime(app));
    }
    *state.ui_mode.lock().unwrap() = UiMode::Idle;
    let _ = win.set_fullscreen(false);
    let _ = win.set_always_on_top(false);
    let _ = win.hide();
}

/// Liten flyttbar tidspille — vises bare når det er lite tid igjen.
fn enter_hud_mode(app: &tauri::AppHandle, win: &tauri::WebviewWindow) {
    let state = app.state::<AppState>();
    let already_hud = *state.ui_mode.lock().unwrap() == UiMode::Hud;
    *state.ui_mode.lock().unwrap() = UiMode::Hud;

    let hud_w = 268.0_f64;
    let hud_h = 56.0_f64;
    let saved_x = *state.hud_x.lock().unwrap();
    let saved_y = *state.hud_y.lock().unwrap();

    let _ = win.set_fullscreen(false);
    let _ = win.set_decorations(false);
    let _ = win.set_always_on_top(true);
    let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(hud_w, hud_h)));

    if !already_hud {
        if let (Some(x), Some(y)) = (saved_x, saved_y) {
            let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        } else if let Ok(Some(monitor)) = win.current_monitor() {
            let scale = monitor.scale_factor();
            let screen = monitor.size().to_logical::<f64>(scale);
            let margin = 18.0_f64;
            let x = (screen.width - hud_w - margin).max(0.0);
            let y = margin;
            let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        }
    }

    let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(hud_w, hud_h)));
    let _ = win.show();
}

/// Velg Idle / Hud ut fra gjenstående tid (eller Locked hvis 0).
/// Ctrl+Win kan tvinge HUD frem via `hud_manual_show`.
fn sync_unlock_window(app: &tauri::AppHandle, win: &tauri::WebviewWindow, remaining: u64) {
    if remaining == 0 {
        *app.state::<AppState>().hud_manual_show.lock().unwrap() = false;
        enter_locked_mode(app, win);
    } else if remaining <= HUD_SHOW_BELOW_SECS
        || *app.state::<AppState>().hud_manual_show.lock().unwrap()
    {
        enter_hud_mode(app, win);
    } else {
        enter_unlocked_idle(app, win);
    }
}

/// Ctrl+Win: vis/skjul tidspilleren mens skjermen er opplåst.
fn toggle_hud_hotkey(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let until = *state.unlocked_until.lock().unwrap();
    let now = now_secs();
    if until <= now {
        return; // låst — ingen pille å vise
    }
    let remaining = until - now;
    let Some(win) = app.get_webview_window("main") else {
        return;
    };

    let manual = *state.hud_manual_show.lock().unwrap();
    let mode = *state.ui_mode.lock().unwrap();
    if mode == UiMode::Hud && (manual || remaining > HUD_SHOW_BELOW_SECS) {
        // Skjul igjen (bare når den ikke «må» vises pga. lite tid)
        if remaining > HUD_SHOW_BELOW_SECS {
            *state.hud_manual_show.lock().unwrap() = false;
            enter_unlocked_idle(app, &win);
        }
        return;
    }

    *state.hud_manual_show.lock().unwrap() = true;
    enter_hud_mode(app, &win);
    let _ = app.emit("time-tick", remaining);
    let _ = app.emit("hud-peek", remaining);
}

/// Windows: global Ctrl+Windows-hurtigtast (RegisterHotKey).
#[cfg(windows)]
fn spawn_ctrl_win_hotkey_thread(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_NOREPEAT, VK_LWIN, VK_RWIN,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, TranslateMessage, WM_HOTKEY, MSG,
        };

        const ID_LWIN: i32 = 1;
        const ID_RWIN: i32 = 2;

        unsafe {
            // Ctrl + Windows-tast (venstre og høyre)
            let ok_l = RegisterHotKey(
                std::ptr::null_mut(),
                ID_LWIN,
                MOD_CONTROL | MOD_NOREPEAT,
                VK_LWIN as u32,
            );
            let ok_r = RegisterHotKey(
                std::ptr::null_mut(),
                ID_RWIN,
                MOD_CONTROL | MOD_NOREPEAT,
                VK_RWIN as u32,
            );
            if ok_l == 0 && ok_r == 0 {
                eprintln!("Klarte ikke å registrere Ctrl+Win-hurtigtast");
                return;
            }

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                if msg.message == WM_HOTKEY {
                    toggle_hud_hotkey(&app);
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            UnregisterHotKey(std::ptr::null_mut(), ID_LWIN);
            UnregisterHotKey(std::ptr::null_mut(), ID_RWIN);
        }
    });
}

#[cfg(not(windows))]
fn spawn_ctrl_win_hotkey_thread(_app: tauri::AppHandle) {}

fn snapshot_runtime(app: &tauri::AppHandle) -> RuntimeState {
    let state = app.state::<AppState>();
    let unlocked_until = *state.unlocked_until.lock().unwrap();
    let earned_today_minutes = *state.earned_today_minutes.lock().unwrap();
    let earned_day_index = *state.earned_day_index.lock().unwrap();
    let hud_x = *state.hud_x.lock().unwrap();
    let hud_y = *state.hud_y.lock().unwrap();
    RuntimeState {
        unlocked_until,
        earned_today_minutes,
        earned_day_index,
        hud_x,
        hud_y,
    }
}

/// Gjenopprett fullskjerm låseskjerm — f.eks. før innstillinger åpnes.
#[tauri::command]
fn ensure_locked_fullscreen(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    enter_locked_mode(&app, &window);
}

/// Felles logikk for å låse opp: legger til `add_seconds` på toppen av
/// eventuell gjenstående tid, lagrer det til disk, og synker vinduet
/// (skjult ved god tid, HUD-pille ved lite tid).
fn start_unlock(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    state: &AppState,
    add_seconds: u64,
) {
    let now = now_secs();
    let new_until = {
        let mut until = state.unlocked_until.lock().unwrap();
        let base = if *until > now { *until } else { now };
        *until = base + add_seconds;
        *until
    };
    let remaining = new_until.saturating_sub(now_secs());
    sync_unlock_window(app, window, remaining);
    let _ = app.emit("unlocked", remaining);
    save_runtime_state(app, &snapshot_runtime(app));
}

/// Sørger for at "opptjent i dag"-telleren nullstilles når datoen ruller over.
fn roll_over_earned_day_if_needed(state: &AppState) {
    let today = today_index();
    let mut day = state.earned_day_index.lock().unwrap();
    if *day != today {
        *day = today;
        *state.earned_today_minutes.lock().unwrap() = 0;
    }
}

// ---------------- Tauri-kommandoer ----------------

#[tauri::command]
fn get_settings_public(state: State<AppState>) -> serde_json::Value {
    let cfg = state.config.lock().unwrap();
    serde_json::json!({
        "unlockTime": cfg.unlock_time,
        "grantMinutes": cfg.grant_minutes,
        "secondsPerHit": cfg.seconds_per_hit,
        "maxEarnMinutesPerDay": cfg.max_earn_minutes_per_day,
        "autostart": cfg.autostart || is_windows_autostart_enabled(),
    })
}

#[tauri::command]
fn get_status(state: State<AppState>) -> serde_json::Value {
    let until = *state.unlocked_until.lock().unwrap();
    let now = now_secs();
    let remaining = if until > now { until - now } else { 0 };
    serde_json::json!({ "remainingSeconds": remaining })
}

#[tauri::command]
fn get_earn_budget(state: State<AppState>) -> serde_json::Value {
    roll_over_earned_day_if_needed(&state);
    let max_per_day = state.config.lock().unwrap().max_earn_minutes_per_day;
    let earned = *state.earned_today_minutes.lock().unwrap();
    let remaining: Option<u32> = if max_per_day == 0 {
        None
    } else {
        Some(max_per_day.saturating_sub(earned))
    };
    serde_json::json!({
        "unlimited": max_per_day == 0,
        "maxPerDay": max_per_day,
        "earnedToday": earned,
        "remaining": remaining,
    })
}

#[tauri::command]
fn verify_pin(pin: String, state: State<AppState>) -> bool {
    let cfg = state.config.lock().unwrap();
    hash_pin(&pin) == cfg.pin_hash
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn update_settings(
    current_pin: String,
    new_pin: Option<String>,
    unlock_time: String,
    grant_minutes: u32,
    seconds_per_hit: u32,
    max_earn_minutes_per_day: u32,
    autostart: bool,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if hash_pin(&current_pin) != cfg.pin_hash {
        return Err("Feil PIN-kode".into());
    }
    if let Some(np) = new_pin {
        let trimmed = np.trim();
        if !trimmed.is_empty() {
            if trimmed.len() < 4 || trimmed.len() > 8 {
                return Err("PIN-koden må være mellom 4 og 8 tegn.".into());
            }
            if !trimmed.chars().all(|c| c.is_ascii_digit()) {
                return Err("PIN-koden kan bare inneholde tall.".into());
            }
            cfg.pin_hash = hash_pin(trimmed);
        }
    }
    cfg.unlock_time = unlock_time;
    cfg.grant_minutes = grant_minutes.max(1);
    cfg.seconds_per_hit = seconds_per_hit.max(1);
    cfg.max_earn_minutes_per_day = max_earn_minutes_per_day;
    cfg.autostart = autostart;
    set_windows_autostart(autostart)?;
    save_config(&app, &cfg);
    Ok(())
}

/// Tilsvarer "Bytt bruker" i det originale dialogvinduet.
#[tauri::command]
fn switch_user() -> Result<(), String> {
    Command::new("rundll32.exe")
        .args(["user32.dll,LockWorkStation"])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Tilsvarer "Slå av PC" i det originale dialogvinduet.
#[tauri::command]
fn shutdown_pc() -> Result<(), String> {
    Command::new("shutdown")
        .args(["/s", "/t", "0"])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Tilsvarer "Få mer tid": en voksen taster inn PIN-koden sin.
#[tauri::command]
fn redeem_more_time(
    pin: String,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let (ok, minutes) = {
        let cfg = state.config.lock().unwrap();
        (hash_pin(&pin) == cfg.pin_hash, cfg.grant_minutes)
    };
    if !ok {
        return Err("Feil PIN-kode".into());
    }
    start_unlock(&app, &window, state.inner(), u64::from(minutes) * 60);
    Ok(minutes)
}

/// Nytt: løs inn tid som er opptjent ved å spille minispillet.
/// Ingen PIN nødvendig — dette er tid barnet har tjent selv.
/// Respekterer en daglig opptjeningsgrense satt i innstillingene.
#[tauri::command]
fn redeem_earned_time(
    minutes: u32,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    roll_over_earned_day_if_needed(&state);
    let max_per_day = state.config.lock().unwrap().max_earn_minutes_per_day;

    let granted = {
        let mut earned = state.earned_today_minutes.lock().unwrap();
        if max_per_day > 0 {
            let budget_left = max_per_day.saturating_sub(*earned);
            if budget_left == 0 {
                return Err(
                    "Du har brukt opp dagens spilletid. Prøv igjen i morgen, eller spør en voksen om mer tid.".into(),
                );
            }
            let g = minutes.min(budget_left);
            *earned += g;
            g
        } else {
            *earned += minutes;
            minutes
        }
    };

    if granted > 0 {
        start_unlock(&app, &window, state.inner(), u64::from(granted) * 60);
    }
    Ok(granted)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let cfg = load_config(app.handle());
            let runtime = load_runtime_state(app.handle());
            let today = today_index();
            let (earned_day, earned_minutes) = if runtime.earned_day_index == today {
                (runtime.earned_day_index, runtime.earned_today_minutes)
            } else {
                (today, 0)
            };

            app.manage(AppState {
                config: Mutex::new(cfg),
                unlocked_until: Mutex::new(runtime.unlocked_until),
                earned_today_minutes: Mutex::new(earned_minutes),
                earned_day_index: Mutex::new(earned_day),
                ui_mode: Mutex::new(UiMode::Locked),
                hud_x: Mutex::new(runtime.hud_x),
                hud_y: Mutex::new(runtime.hud_y),
                hud_manual_show: Mutex::new(false),
            });

            if let Some(win) = app.get_webview_window("main") {
                let remaining = runtime.unlocked_until.saturating_sub(now_secs());
                if remaining > 0 {
                    sync_unlock_window(app.handle(), &win, remaining);
                } else {
                    enter_locked_mode(app.handle(), &win);
                }
            }

            // Ctrl+Windows: hent frem / skjul tidspilleren
            spawn_ctrl_win_hotkey_thread(app.handle().clone());

            // Bakgrunnstråd: teller ned hvert sekund. HUD vises bare når
            // det er lite tid igjen; ellers er vinduet skjult.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let state = app_handle.state::<AppState>();
                let until = *state.unlocked_until.lock().unwrap();
                let now = now_secs();
                if until > now {
                    let remaining = until - now;
                    let _ = app_handle.emit("time-tick", remaining);
                    if let Some(win) = app_handle.get_webview_window("main") {
                        sync_unlock_window(&app_handle, &win, remaining);
                    }
                } else if until != 0 {
                    *state.unlocked_until.lock().unwrap() = 0;
                    if let Some(win) = app_handle.get_webview_window("main") {
                        enter_locked_mode(&app_handle, &win);
                    }
                    let _ = app_handle.emit("locked", ());
                    save_runtime_state(&app_handle, &snapshot_runtime(&app_handle));
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Låseskjermen skal ikke kunne lukkes med Alt+F4 e.l. —
            // den skjules i stedet. Nedtellingen fortsetter uansett i
            // bakgrunnen og vinduet dukker opp igjen selv.
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    window.hide().ok();
                }
                tauri::WindowEvent::Moved(pos) => {
                    // Husk HUD-posisjon mens brukeren drar (skrives til disk ved lås/unlock)
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    if *state.ui_mode.lock().unwrap() != UiMode::Hud {
                        return;
                    }
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let logical = pos.to_logical::<f64>(scale);
                    *state.hud_x.lock().unwrap() = Some(logical.x);
                    *state.hud_y.lock().unwrap() = Some(logical.y);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings_public,
            get_status,
            get_earn_budget,
            verify_pin,
            update_settings,
            switch_user,
            shutdown_pc,
            redeem_more_time,
            redeem_earned_time,
            ensure_locked_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("feil under oppstart av Tauri-appen");
}
