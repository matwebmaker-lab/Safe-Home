// Skjuler ekstra konsoll-vindu på Windows i release-bygg
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
#[cfg(not(debug_assertions))]
use tauri_plugin_updater::UpdaterExt;

/// Når true: Windows-tast (Start-meny) blokkeres mens låseskjerm/HUD er synlig.
static BLOCK_WIN_KEY: AtomicBool = AtomicBool::new(true);

/// Når true: HUD-hurtigtasten er midlertidig avregistrert (bruker velger ny kombinasjon).
static HUD_HOTKEY_CAPTURE: AtomicBool = AtomicBool::new(false);

fn set_block_win_key(block: bool) {
    BLOCK_WIN_KEY.store(block, Ordering::SeqCst);
}

fn set_hud_hotkey_capture(capturing: bool) {
    HUD_HOTKEY_CAPTURE.store(capturing, Ordering::SeqCst);
}

/// Eldre config-filer uten feltet behandles som allerede konfigurert.
fn default_configured() -> bool {
    true
}

fn default_hud_hotkey() -> String {
    "Ctrl+Shift+H".to_string()
}

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
    /// Global hurtigtast for å vise/skjule tidboksen, f.eks. "Ctrl+Shift+H".
    #[serde(default = "default_hud_hotkey")]
    hud_hotkey: String,
    /// false til førstegangsveiviseren er fullført.
    #[serde(default = "default_configured")]
    configured: bool,
}

impl Default for Config {
    fn default() -> Self {
        // Tom PIN til førstegangsoppsett er fullført.
        Config {
            pin_hash: String::new(),
            unlock_time: "07:00".to_string(),
            grant_minutes: 30,
            seconds_per_hit: 20,
            max_earn_minutes_per_day: 90,
            autostart: true,
            hud_hotkey: default_hud_hotkey(),
            configured: false,
        }
    }
}

/// Tolker en hurtigtast-streng ("Ctrl+Shift+H") til RegisterHotKey-argumenter.
fn parse_hud_hotkey(s: &str) -> Result<(u32, u32), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
        };

        let mut mods: u32 = 0;
        let mut vk: Option<u32> = None;

        for part in s.split('+').map(str::trim).filter(|p| !p.is_empty()) {
            let lower = part.to_ascii_lowercase();
            match lower.as_str() {
                "ctrl" | "control" => mods |= MOD_CONTROL,
                "shift" => mods |= MOD_SHIFT,
                "alt" => mods |= MOD_ALT,
                "win" | "windows" | "meta" | "super" => {
                    return Err("Windows-tasten kan ikke brukes i hurtigtasten.".into());
                }
                _ => {
                    if vk.is_some() {
                        return Err("Hurtigtasten kan bare ha én hovedtast.".into());
                    }
                    vk = Some(parse_hotkey_vk(part)?);
                }
            }
        }

        if mods == 0 {
            return Err("Hurtigtasten må inkludere Ctrl, Shift og/eller Alt.".into());
        }
        let vk = vk.ok_or_else(|| "Hurtigtasten mangler en hovedtast (f.eks. H).".to_string())?;
        Ok((mods | MOD_NOREPEAT, vk))
    }
    #[cfg(not(windows))]
    {
        let _ = s;
        Err("Hurtigtaster støttes bare på Windows.".into())
    }
}

fn parse_hotkey_vk(part: &str) -> Result<u32, String> {
    let upper = part.to_ascii_uppercase();
    if upper.len() == 1 {
        let c = upper.chars().next().unwrap();
        if c.is_ascii_alphanumeric() {
            return Ok(c as u32);
        }
    }
    if let Some(n) = upper.strip_prefix('F') {
        if let Ok(num) = n.parse::<u32>() {
            if (1..=24).contains(&num) {
                return Ok(0x70 + (num - 1)); // VK_F1 = 0x70
            }
        }
    }
    match upper.as_str() {
        "SPACE" | " " => Ok(0x20),
        "TAB" => Ok(0x09),
        "ESCAPE" | "ESC" => Ok(0x1B),
        "INSERT" | "INS" => Ok(0x2D),
        "DELETE" | "DEL" => Ok(0x2E),
        "HOME" => Ok(0x24),
        "END" => Ok(0x23),
        "PAGEUP" | "PGUP" => Ok(0x21),
        "PAGEDOWN" | "PGDN" => Ok(0x22),
        "UP" | "ARROWUP" => Ok(0x26),
        "DOWN" | "ARROWDOWN" => Ok(0x28),
        "LEFT" | "ARROWLEFT" => Ok(0x25),
        "RIGHT" | "ARROWRIGHT" => Ok(0x27),
        _ => Err(format!("Ukjent tast: {part}")),
    }
}

fn normalize_hud_hotkey(s: &str) -> Result<String, String> {
    let (mods, vk) = parse_hud_hotkey(s)?;
    Ok(format_hud_hotkey(mods, vk))
}

fn format_hud_hotkey(mods: u32, vk: u32) -> String {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            MOD_ALT, MOD_CONTROL, MOD_SHIFT,
        };
        let mut parts = Vec::new();
        if mods & MOD_CONTROL != 0 {
            parts.push("Ctrl".to_string());
        }
        if mods & MOD_SHIFT != 0 {
            parts.push("Shift".to_string());
        }
        if mods & MOD_ALT != 0 {
            parts.push("Alt".to_string());
        }
        parts.push(format_hotkey_vk(vk));
        parts.join("+")
    }
    #[cfg(not(windows))]
    {
        let _ = (mods, vk);
        default_hud_hotkey()
    }
}

fn format_hotkey_vk(vk: u32) -> String {
    match vk {
        0x20 => "Space".into(),
        0x09 => "Tab".into(),
        0x1B => "Esc".into(),
        0x2D => "Insert".into(),
        0x2E => "Delete".into(),
        0x24 => "Home".into(),
        0x23 => "End".into(),
        0x21 => "PageUp".into(),
        0x22 => "PageDown".into(),
        0x26 => "Up".into(),
        0x28 => "Down".into(),
        0x25 => "Left".into(),
        0x27 => "Right".into(),
        0x70..=0x87 => format!("F{}", vk - 0x70 + 1),
        c if (b'A' as u32..=b'Z' as u32).contains(&c) || (b'0' as u32..=b'9' as u32).contains(&c) => {
            char::from_u32(c).unwrap_or('?').to_string()
        }
        _ => format!("0x{vk:X}"),
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
    /// Unix-tid for siste oppdateringssjekk mot GitHub Releases.
    #[serde(default)]
    last_update_check: u64,
}

/// Cachet status for app-oppdateringer (vist i innstillinger).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    current_version: String,
    available: bool,
    latest_version: Option<String>,
    notes: Option<String>,
    last_checked_at: u64,
    checking: bool,
    installing: bool,
    downloaded: u64,
    total: Option<u64>,
    error: Option<String>,
}

impl UpdateStatus {
    fn new(current_version: String) -> Self {
        Self {
            current_version,
            available: false,
            latest_version: None,
            notes: None,
            last_checked_at: 0,
            checking: false,
            installing: false,
            downloaded: 0,
            total: None,
            error: None,
        }
    }
}

#[cfg(not(debug_assertions))]
const UPDATE_CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;

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
    /// Bruker har skjult HUD med Ctrl+Win (også når det er lite tid igjen).
    hud_manual_hide: Mutex<bool>,
    /// Innstillinger er åpne (tray / ny start) — ikke synk Idle/Hud over UI-et.
    settings_focus: Mutex<bool>,
    update_status: Mutex<UpdateStatus>,
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
    // Første installasjon: start med Windows som standard, allerede før
    // førstegangsveiviseren er fullført.
    let cfg = Config::default();
    let _ = set_windows_autostart(cfg.autostart);
    cfg
}

fn validate_pin(pin: &str) -> Result<(), String> {
    let trimmed = pin.trim();
    if trimmed.len() < 4 || trimmed.len() > 8 {
        return Err("PIN-koden må være mellom 4 og 8 tegn.".into());
    }
    if !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("PIN-koden kan bare inneholde tall.".into());
    }
    Ok(())
}

const AUTOSTART_VALUE_NAME: &str = "Safe Home";

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
    set_block_win_key(true);
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
    set_block_win_key(false);
    let _ = win.set_fullscreen(false);
    let _ = win.set_always_on_top(false);
    let _ = win.hide();
}

/// Liten flyttbar tidspille — vises bare når det er lite tid igjen.
fn enter_hud_mode(app: &tauri::AppHandle, win: &tauri::WebviewWindow) {
    let state = app.state::<AppState>();
    let already_hud = *state.ui_mode.lock().unwrap() == UiMode::Hud;
    *state.ui_mode.lock().unwrap() = UiMode::Hud;
    set_block_win_key(true);

    // Litt større enn selve pillen, så avrundede hjørner har transparent
    // luft rundt (WebView2/DWM tegner ellers en rektangulær «ramme»).
    let hud_w = 312.0_f64;
    let hud_h = 64.0_f64;
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
/// Ctrl+Win kan tvinge HUD frem (`hud_manual_show`) eller skjule den
/// midlertidig (`hud_manual_hide`), også når det er lite tid igjen.
fn sync_unlock_window(app: &tauri::AppHandle, win: &tauri::WebviewWindow, remaining: u64) {
    if *app.state::<AppState>().settings_focus.lock().unwrap() {
        return;
    }
    let state = app.state::<AppState>();
    if remaining == 0 {
        *state.hud_manual_show.lock().unwrap() = false;
        *state.hud_manual_hide.lock().unwrap() = false;
        enter_locked_mode(app, win);
    } else if *state.hud_manual_hide.lock().unwrap() {
        enter_unlocked_idle(app, win);
    } else if remaining <= HUD_SHOW_BELOW_SECS || *state.hud_manual_show.lock().unwrap() {
        enter_hud_mode(app, win);
    } else {
        enter_unlocked_idle(app, win);
    }
}

/// Vis låseskjerm og be frontend åpne PIN-gate for innstillinger.
fn request_open_settings(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    *state.settings_focus.lock().unwrap() = true;
    if let Some(win) = app.get_webview_window("main") {
        enter_locked_mode(app, &win);
        let _ = app.emit("open-settings", ());
    }
}

fn setup_system_tray(app: &tauri::App) -> tauri::Result<()> {
    let settings_item = MenuItem::with_id(app, "settings", "Innstillinger", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings_item])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Safe Home")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "settings" {
                request_open_settings(app);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                request_open_settings(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// Ctrl+Win: vis/skjul tidspilleren mens skjermen er opplåst.
fn toggle_hud_hotkey(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    if *state.settings_focus.lock().unwrap() {
        return;
    }
    let until = *state.unlocked_until.lock().unwrap();
    let now = now_secs();
    if until <= now {
        return; // låst — ingen pille å vise
    }
    let remaining = until - now;
    let Some(win) = app.get_webview_window("main") else {
        return;
    };

    let mode = *state.ui_mode.lock().unwrap();
    if mode == UiMode::Hud {
        *state.hud_manual_show.lock().unwrap() = false;
        *state.hud_manual_hide.lock().unwrap() = true;
        enter_unlocked_idle(app, &win);
        return;
    }

    *state.hud_manual_hide.lock().unwrap() = false;
    *state.hud_manual_show.lock().unwrap() = true;
    enter_hud_mode(app, &win);
    let _ = app.emit("time-tick", remaining);
    let _ = app.emit("hud-peek", remaining);
}

/// Windows: global hurtigtast for tidboksen (standard Ctrl+Shift+H).
/// Leser config fortløpende, så innstillingsendringer gjelder uten restart.
#[cfg(windows)]
fn spawn_hud_hotkey_thread(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, PeekMessageW, TranslateMessage, PM_REMOVE, WM_HOTKEY, MSG,
        };

        const HOTKEY_ID: i32 = 1;
        let mut registered: Option<(u32, u32)> = None;

        loop {
            // Mens brukeren velger ny hurtigtast: avregistrer midlertidig
            // så kombinasjonen når WebView (ellers «spiser» RegisterHotKey den).
            if HUD_HOTKEY_CAPTURE.load(Ordering::SeqCst) {
                if registered.is_some() {
                    unsafe {
                        UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID);
                    }
                    registered = None;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }

            let desired = {
                let state = app.state::<AppState>();
                let cfg = state.config.lock().unwrap();
                parse_hud_hotkey(&cfg.hud_hotkey).unwrap_or_else(|_| {
                    parse_hud_hotkey(&default_hud_hotkey()).expect("standard-hurtigtast")
                })
            };

            if registered != Some(desired) {
                unsafe {
                    if registered.is_some() {
                        UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID);
                    }
                    let ok = RegisterHotKey(
                        std::ptr::null_mut(),
                        HOTKEY_ID,
                        desired.0,
                        desired.1,
                    );
                    if ok == 0 {
                        eprintln!(
                            "Klarte ikke å registrere HUD-hurtigtast (allerede i bruk?)"
                        );
                        registered = None;
                    } else {
                        registered = Some(desired);
                    }
                }
            }

            unsafe {
                let mut msg: MSG = std::mem::zeroed();
                while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                    if msg.message == WM_HOTKEY {
                        toggle_hud_hotkey(&app);
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}

#[cfg(not(windows))]
fn spawn_hud_hotkey_thread(_app: tauri::AppHandle) {}

/// Windows: lavnivå tastaturhook som stopper Alt+F4 og Start-menyen
/// (Win-tast) mens appen er synlig.
#[cfg(windows)]
fn spawn_kiosk_keyboard_hook() {
    std::thread::spawn(|| {
        use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_F4, VK_LWIN, VK_MENU, VK_RWIN,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
            UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, MSG, WH_KEYBOARD_LL,
            WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
        };

        unsafe extern "system" fn hook_proc(
            code: i32,
            wparam: WPARAM,
            lparam: LPARAM,
        ) -> LRESULT {
            if code == HC_ACTION as i32 {
                let info = &*(lparam as *const KBDLLHOOKSTRUCT);
                let vk = info.vkCode;
                let is_down =
                    wparam == WM_KEYDOWN as WPARAM || wparam == WM_SYSKEYDOWN as WPARAM;
                let is_up = wparam == WM_KEYUP as WPARAM || wparam == WM_SYSKEYUP as WPARAM;

                if is_down || is_up {
                    let alt_down = (info.flags & LLKHF_ALTDOWN) != 0
                        || GetAsyncKeyState(VK_MENU as i32) < 0;
                    if vk == VK_F4 as u32 && alt_down {
                        return 1;
                    }

                    if BLOCK_WIN_KEY.load(Ordering::SeqCst) {
                        if vk == VK_LWIN as u32 || vk == VK_RWIN as u32 {
                            return 1;
                        }
                        // Ctrl+Esc åpner også Start-menyen
                        if vk == VK_ESCAPE as u32 && GetAsyncKeyState(VK_CONTROL as i32) < 0 {
                            return 1;
                        }
                    }
                }
            }
            CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
        }

        unsafe {
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), std::ptr::null_mut(), 0);
            if hook.is_null() {
                eprintln!("Klarte ikke å installere tastaturhook (Alt+F4 / Start)");
                return;
            }

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            UnhookWindowsHookEx(hook);
        }
    });
}

#[cfg(not(windows))]
fn spawn_kiosk_keyboard_hook() {}

fn snapshot_runtime(app: &tauri::AppHandle) -> RuntimeState {
    let state = app.state::<AppState>();
    let unlocked_until = *state.unlocked_until.lock().unwrap();
    let earned_today_minutes = *state.earned_today_minutes.lock().unwrap();
    let earned_day_index = *state.earned_day_index.lock().unwrap();
    let hud_x = *state.hud_x.lock().unwrap();
    let hud_y = *state.hud_y.lock().unwrap();
    let last_update_check = state.update_status.lock().unwrap().last_checked_at;
    RuntimeState {
        unlocked_until,
        earned_today_minutes,
        earned_day_index,
        hud_x,
        hud_y,
        last_update_check,
    }
}

fn emit_update_status(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let status = state.update_status.lock().unwrap().clone();
    let _ = app.emit("update-status", status);
}

fn with_update_status_mut<R>(app: &tauri::AppHandle, f: impl FnOnce(&mut UpdateStatus) -> R) -> R {
    let state = app.state::<AppState>();
    let mut status = state.update_status.lock().unwrap();
    f(&mut status)
}

#[cfg(not(debug_assertions))]
fn persist_last_update_check(app: &tauri::AppHandle, checked_at: u64) {
    let mut runtime = snapshot_runtime(app);
    runtime.last_update_check = checked_at;
    save_runtime_state(app, &runtime);
}

/// Sjekker GitHub Releases for ny versjon. Installerer ikke — bare oppdaterer status.
#[cfg(not(debug_assertions))]
async fn check_for_update_inner(app: tauri::AppHandle, force: bool) {
    let should_skip = with_update_status_mut(&app, |status| {
        if status.checking || status.installing {
            return true;
        }
        if !force
            && status.last_checked_at > 0
            && now_secs().saturating_sub(status.last_checked_at) < UPDATE_CHECK_INTERVAL_SECS
        {
            return true;
        }
        status.checking = true;
        status.error = None;
        false
    });
    if should_skip {
        return;
    }
    emit_update_status(&app);

    let result = async {
        let updater = app.updater().map_err(|e| e.to_string())?;
        updater.check().await.map_err(|e| e.to_string())
    }
    .await;

    let checked_at = now_secs();
    with_update_status_mut(&app, |status| {
        status.checking = false;
        status.last_checked_at = checked_at;
        match result {
            Ok(Some(update)) => {
                status.available = true;
                status.latest_version = Some(update.version.clone());
                status.notes = update.body.clone();
                status.error = None;
            }
            Ok(None) => {
                status.available = false;
                status.latest_version = None;
                status.notes = None;
                status.error = None;
            }
            Err(err) => {
                status.error = Some(err);
            }
        }
    });
    persist_last_update_check(&app, checked_at);
    emit_update_status(&app);
}

#[cfg(debug_assertions)]
async fn check_for_update_inner(app: tauri::AppHandle, _force: bool) {
    with_update_status_mut(&app, |status| {
        status.checking = false;
        status.available = false;
        status.latest_version = None;
        status.notes = None;
        status.last_checked_at = now_secs();
        status.error = None;
    });
    emit_update_status(&app);
}

#[cfg(not(debug_assertions))]
async fn install_update_inner(app: tauri::AppHandle) -> Result<(), String> {
    let early_err = with_update_status_mut(&app, |status| {
        if status.installing {
            return Some("Oppdatering pågår allerede.".to_string());
        }
        if status.checking {
            return Some("Venter på oppdateringssjekk. Prøv igjen om litt.".to_string());
        }
        status.installing = true;
        status.downloaded = 0;
        status.total = None;
        status.error = None;
        None
    });
    if let Some(err) = early_err {
        return Err(err);
    }
    emit_update_status(&app);

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            with_update_status_mut(&app, |status| {
                status.installing = false;
                status.error = Some(e.to_string());
            });
            emit_update_status(&app);
            return Err(e.to_string());
        }
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            with_update_status_mut(&app, |status| {
                status.installing = false;
                status.available = false;
                status.latest_version = None;
                status.notes = None;
                status.error = Some("Ingen ny versjon tilgjengelig.".into());
            });
            emit_update_status(&app);
            return Err("Ingen ny versjon tilgjengelig.".into());
        }
        Err(e) => {
            with_update_status_mut(&app, |status| {
                status.installing = false;
                status.error = Some(e.to_string());
            });
            emit_update_status(&app);
            return Err(e.to_string());
        }
    };

    with_update_status_mut(&app, |status| {
        status.available = true;
        status.latest_version = Some(update.version.clone());
        status.notes = update.body.clone();
    });
    emit_update_status(&app);

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    let install_result = update
        .download_and_install(
            move |chunk_len, total| {
                downloaded = downloaded.saturating_add(chunk_len as u64);
                with_update_status_mut(&progress_app, |status| {
                    status.downloaded = downloaded;
                    status.total = total;
                });
                let _ = progress_app.emit(
                    "update-progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "total": total,
                    }),
                );
                emit_update_status(&progress_app);
            },
            || {},
        )
        .await;

    match install_result {
        Ok(()) => {
            with_update_status_mut(&app, |status| {
                status.installing = false;
                status.available = false;
                status.error = None;
            });
            emit_update_status(&app);
            app.restart();
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            with_update_status_mut(&app, |status| {
                status.installing = false;
                status.error = Some(msg.clone());
            });
            emit_update_status(&app);
            Err(msg)
        }
    }
}

#[cfg(debug_assertions)]
async fn install_update_inner(_app: tauri::AppHandle) -> Result<(), String> {
    Err("Oppdateringer er bare tilgjengelig i installerte release-bygg.".into())
}

/// Gjenopprett fullskjerm låseskjerm — f.eks. før innstillinger åpnes.
#[tauri::command]
fn ensure_locked_fullscreen(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    enter_locked_mode(&app, &window);
}

/// Hold låseskjerm synlig mens innstillinger er åpne (unngår at Idle skjuler UI).
#[tauri::command]
fn begin_settings_ui(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    *app.state::<AppState>().settings_focus.lock().unwrap() = true;
    enter_locked_mode(&app, &window);
}

/// Ferdig med innstillinger — synk Idle/Hud ut fra gjenstående tid.
#[tauri::command]
fn end_settings_ui(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    *app.state::<AppState>().settings_focus.lock().unwrap() = false;
    set_hud_hotkey_capture(false);
    let until = *app.state::<AppState>().unlocked_until.lock().unwrap();
    let remaining = until.saturating_sub(now_secs());
    if remaining > 0 {
        sync_unlock_window(&app, &window, remaining);
        let _ = app.emit("unlocked", remaining);
    } else {
        enter_locked_mode(&app, &window);
    }
}

/// Pause global HUD-hurtigtast mens brukeren velger ny kombinasjon i UI.
#[tauri::command]
fn begin_hud_hotkey_capture() {
    set_hud_hotkey_capture(true);
}

#[tauri::command]
fn end_hud_hotkey_capture() {
    set_hud_hotkey_capture(false);
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
    let hud_hotkey = normalize_hud_hotkey(&cfg.hud_hotkey)
        .unwrap_or_else(|_| default_hud_hotkey());
    serde_json::json!({
        "unlockTime": cfg.unlock_time,
        "grantMinutes": cfg.grant_minutes,
        "secondsPerHit": cfg.seconds_per_hit,
        "maxEarnMinutesPerDay": cfg.max_earn_minutes_per_day,
        "autostart": cfg.autostart || is_windows_autostart_enabled(),
        "hudHotkey": hud_hotkey,
        "needsSetup": !cfg.configured,
    })
}

/// Førstegangsoppsett: PIN og skjermtidsinnstillinger. Kun når appen ikke er konfigurert.
#[tauri::command]
fn complete_setup(
    pin: String,
    unlock_time: String,
    grant_minutes: u32,
    seconds_per_hit: u32,
    max_earn_minutes_per_day: u32,
    autostart: bool,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if cfg.configured {
        return Err("Appen er allerede konfigurert.".into());
    }
    validate_pin(&pin)?;
    cfg.pin_hash = hash_pin(pin.trim());
    cfg.unlock_time = unlock_time;
    cfg.grant_minutes = grant_minutes.max(1);
    cfg.seconds_per_hit = seconds_per_hit.max(1);
    cfg.max_earn_minutes_per_day = max_earn_minutes_per_day;
    cfg.autostart = autostart;
    cfg.configured = true;
    set_windows_autostart(autostart)?;
    save_config(&app, &cfg);
    Ok(())
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
    hud_hotkey: String,
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
            validate_pin(trimmed)?;
            cfg.pin_hash = hash_pin(trimmed);
        }
    }
    let hud_hotkey = normalize_hud_hotkey(hud_hotkey.trim())?;
    cfg.unlock_time = unlock_time;
    cfg.grant_minutes = grant_minutes.max(1);
    cfg.seconds_per_hit = seconds_per_hit.max(1);
    cfg.max_earn_minutes_per_day = max_earn_minutes_per_day;
    cfg.autostart = autostart;
    cfg.hud_hotkey = hud_hotkey;
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

#[tauri::command]
fn get_update_status(state: State<AppState>) -> UpdateStatus {
    state.update_status.lock().unwrap().clone()
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    check_for_update_inner(app.clone(), true).await;
    let state = app.state::<AppState>();
    let status = state.update_status.lock().unwrap().clone();
    Ok(status)
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    install_update_inner(app).await
}

/// Sjekker GitHub Releases for ny versjon (daglig). Installerer bare når brukeren ber om det i innstillinger.
#[cfg(not(debug_assertions))]
fn spawn_update_checker(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Kort pause slik at UI rekker å komme opp først.
        std::thread::sleep(std::time::Duration::from_secs(3));
        loop {
            tauri::async_runtime::block_on(check_for_update_inner(app.clone(), false));
            // Sjekk hver time om det er gått 24 timer siden sist.
            std::thread::sleep(std::time::Duration::from_secs(60 * 60));
        }
    });
}

fn main() {
    tauri::Builder::default()
        // Må registreres først slik at en ny start ikke spinner opp en 2. prosess.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            request_open_settings(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                hud_manual_hide: Mutex::new(false),
                settings_focus: Mutex::new(false),
                update_status: Mutex::new({
                    let mut status =
                        UpdateStatus::new(app.package_info().version.to_string());
                    status.last_checked_at = runtime.last_update_check;
                    status
                }),
            });

            if let Some(win) = app.get_webview_window("main") {
                let remaining = runtime.unlocked_until.saturating_sub(now_secs());
                if remaining > 0 {
                    sync_unlock_window(app.handle(), &win, remaining);
                } else {
                    enter_locked_mode(app.handle(), &win);
                }
            }

            setup_system_tray(app)?;

            // Global hurtigtast: vis / skjul tidspilleren (standard Ctrl+Shift+H)
            spawn_hud_hotkey_thread(app.handle().clone());
            // Blokker Alt+F4 og Start-menyen over låseskjermen
            spawn_kiosk_keyboard_hook();

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

            // Daglig oppdateringssjekk fra GitHub Releases (kun i release-bygg).
            // Installasjon skjer bare når en voksen trykker «Oppdater» i innstillinger.
            #[cfg(not(debug_assertions))]
            spawn_update_checker(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            // Appen skal ikke kunne lukkes med Alt+F4 e.l.
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
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
            complete_setup,
            get_status,
            get_earn_budget,
            verify_pin,
            update_settings,
            switch_user,
            shutdown_pc,
            redeem_more_time,
            redeem_earned_time,
            ensure_locked_fullscreen,
            begin_settings_ui,
            end_settings_ui,
            begin_hud_hotkey_capture,
            end_hud_hotkey_capture,
            get_update_status,
            check_for_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("feil under oppstart av Tauri-appen");
}
