//! Shared helpers for the Safe Home Windows watchdog:
//! pause/resume around updates, tamper signalling, health checks,
//! and sealed payload paths used to restore deleted binaries.

#![allow(dead_code)] // some helpers are used only from the watchdog bin or release paths

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SERVICE_NAME: &str = "SafeHomeWatchdog";

/// Sealed copy of the real lock UI (`sh-host.exe`).
pub const SEALED_HOST_NAME: &str = "host.exe";
/// Sealed copy of the public Start Menu launcher (`safe-home.exe`).
pub const SEALED_LAUNCHER_NAME: &str = "launcher.exe";

/// Machine-wide config written by the installer (ProgramData).
pub fn program_data_dir() -> PathBuf {
    let base = std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("Safe Home")
}

/// Directory for sealed binaries the watchdog can restore into Program Files.
pub fn payload_dir() -> PathBuf {
    program_data_dir().join("payload")
}

pub fn sealed_host_path() -> PathBuf {
    payload_dir().join(SEALED_HOST_NAME)
}

pub fn sealed_launcher_path() -> PathBuf {
    payload_dir().join(SEALED_LAUNCHER_NAME)
}

/// Staging copy of adult settings (PIN hash, etc.) written by the host as the
/// interactive user. Anyone who can write ProgramData can change this file —
/// the hardened [`sealed_config_path`] is the durable backup.
pub fn pending_config_path() -> PathBuf {
    program_data_dir().join("config.pending.json")
}

/// Hardened adult-settings backup. Watchdog (SYSTEM) copies pending → here and
/// ACLs the file so standard users can read but not modify/delete it.
pub fn sealed_config_path() -> PathBuf {
    program_data_dir().join("config.seal")
}

/// Public launcher path next to the host binary (same install directory).
pub fn launcher_path_beside_host(host_exe: &Path) -> PathBuf {
    host_exe
        .parent()
        .map(|p| p.join("safe-home.exe"))
        .unwrap_or_else(|| PathBuf::from("safe-home.exe"))
}

pub fn watchdog_config_path() -> PathBuf {
    program_data_dir().join("watchdog.json")
}

/// Absolute path to the install-time PIN salt file, if the installer (or a
/// first-run fallback) recorded one in `watchdog.json`.
pub fn pin_salt_path_from_watchdog() -> Option<PathBuf> {
    #[derive(serde::Deserialize)]
    struct WatchdogFile {
        #[serde(default)]
        salt_path: Option<String>,
    }
    let data = fs::read_to_string(watchdog_config_path()).ok()?;
    let parsed: WatchdogFile = serde_json::from_str(&data).ok()?;
    let raw = parsed.salt_path.filter(|s| !s.trim().is_empty())?;
    Some(PathBuf::from(raw))
}

/// Read the per-machine PIN salt bytes (random file created at install).
pub fn load_pin_salt_bytes() -> Option<Vec<u8>> {
    let path = pin_salt_path_from_watchdog()?;
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 16 {
        return None;
    }
    Some(bytes)
}

pub fn watchdog_pause_path() -> PathBuf {
    program_data_dir().join("watchdog.pause")
}

pub fn watchdog_tamper_path() -> PathBuf {
    program_data_dir().join("watchdog.tamper")
}

pub fn heartbeat_path() -> PathBuf {
    program_data_dir().join("heartbeat")
}

/// True when the installer has registered a watchdog for this machine.
pub fn is_watchdog_configured() -> bool {
    watchdog_config_path().is_file()
}

/// Restrict `config.seal` to SYSTEM+Administrators (full) and Users (read).
/// Standard accounts can restore from it but cannot wipe the adult PIN backup.
pub fn harden_sealed_config_acl() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let path = sealed_config_path();
        if !path.is_file() {
            return;
        }
        let path_str = path.to_string_lossy().replace('/', "\\");
        let _ = Command::new("icacls.exe")
            .args([
                &path_str,
                "/inheritance:r",
                "/grant:r",
                "NT AUTHORITY\\SYSTEM:F",
                "/grant:r",
                "BUILTIN\\Administrators:F",
                "/grant:r",
                "BUILTIN\\Users:R",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

/// Copy pending settings into the hardened seal when content differs.
/// Returns true when the seal file was written/updated.
pub fn sync_sealed_config_from_pending() -> bool {
    let pending = pending_config_path();
    let sealed = sealed_config_path();
    let Ok(pending_bytes) = fs::read(&pending) else {
        return false;
    };
    if pending_bytes.is_empty() {
        return false;
    }
    if let Ok(existing) = fs::read(&sealed) {
        if existing == pending_bytes {
            return false;
        }
    }
    let dir = program_data_dir();
    let _ = fs::create_dir_all(&dir);
    let tmp = dir.join("config.seal.tmp");
    if fs::write(&tmp, &pending_bytes).is_err() {
        return false;
    }
    if fs::rename(&tmp, &sealed).is_err() {
        let _ = fs::remove_file(&tmp);
        // rename can fail across weird FS setups — try direct write
        if fs::write(&sealed, &pending_bytes).is_err() {
            return false;
        }
    }
    harden_sealed_config_acl();
    true
}

/// Tell the watchdog service not to respawn Safe Home (updates / uninstall).
///
/// Writes an absolute unix-seconds deadline; the service treats any existing
/// pause file whose deadline is in the future (or missing a parseable deadline)
/// as active. Default pause window: 10 minutes.
pub fn pause_watchdog(duration_secs: u64) {
    let dir = program_data_dir();
    let _ = fs::create_dir_all(&dir);
    let until = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().saturating_add(duration_secs))
        .unwrap_or(u64::MAX);
    let _ = fs::write(watchdog_pause_path(), format!("{until}\n"));
    // Avoid treating the intentional exit as a kill when the new build starts.
    clear_heartbeat();
    clear_tamper();
}

/// Remove the pause marker so the watchdog may respawn again.
pub fn clear_watchdog_pause() {
    let _ = fs::remove_file(watchdog_pause_path());
}

/// Returns true if a pause is currently in effect.
pub fn is_watchdog_paused() -> bool {
    let path = watchdog_pause_path();
    let Ok(contents) = fs::read_to_string(&path) else {
        return false;
    };
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        // Empty pause file = paused indefinitely until cleared.
        return true;
    }
    let Ok(until) = trimmed.parse::<u64>() else {
        return true;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    now < until
}

/// Signal that Safe Home was terminated unexpectedly (Task Manager kill, etc.).
/// The main app consumes this on next start and forces lock + cleared screen time.
pub fn mark_tamper() {
    let dir = program_data_dir();
    let _ = fs::create_dir_all(&dir);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = fs::write(watchdog_tamper_path(), format!("{now}\n"));
}

pub fn clear_tamper() {
    let _ = fs::remove_file(watchdog_tamper_path());
}

/// Returns true once if a tamper marker was present (and clears it).
pub fn take_tamper() -> bool {
    let path = watchdog_tamper_path();
    if !path.is_file() {
        return false;
    }
    let _ = fs::remove_file(&path);
    true
}

/// Alive signal written by the main app so a later restart can detect mid-session kill
/// even if the watchdog was also killed.
pub fn write_heartbeat() {
    let dir = program_data_dir();
    let _ = fs::create_dir_all(&dir);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = fs::write(heartbeat_path(), format!("{now}\n"));
}

pub fn clear_heartbeat() {
    let _ = fs::remove_file(heartbeat_path());
}

fn read_heartbeat_secs() -> Option<u64> {
    let contents = fs::read_to_string(heartbeat_path()).ok()?;
    contents.trim().parse().ok()
}

fn system_uptime_secs() -> u64 {
    #[cfg(windows)]
    {
        // GetTickCount64: ms since boot (wraps only after ~49 days on 32-bit tick; 64-bit is fine).
        unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() / 1000 }
    }
    #[cfg(not(windows))]
    {
        0
    }
}

/// Detect that the previous Safe Home instance died while Windows kept running
/// (e.g. both app and watchdog killed from Task Manager). Skips the short window
/// after boot so a normal reboot does not wipe remaining screen time.
pub fn detect_unclean_exit() -> bool {
    let Some(last) = read_heartbeat_secs() else {
        return false;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let age = now.saturating_sub(last);
    // Heartbeat is written every ~1s; anything older means the process is gone.
    if age < 3 {
        return false;
    }
    let uptime = system_uptime_secs();
    // After reboot the heartbeat is old but uptime is small — not a kill.
    if uptime < age.saturating_add(30) {
        return false;
    }
    true
}

/// Whether the SafeHomeWatchdog service is currently running.
pub fn is_watchdog_service_running() -> bool {
    #[cfg(windows)]
    {
        use windows_service::service::ServiceAccess;
        use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

        let Ok(manager) =
            ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        else {
            return false;
        };
        let Ok(service) = manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS) else {
            return false;
        };
        match service.query_status() {
            Ok(status) => {
                status.current_state == windows_service::service::ServiceState::Running
            }
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        false
    }
}
