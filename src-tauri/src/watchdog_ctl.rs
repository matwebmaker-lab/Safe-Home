//! Shared helpers for the Safe Home Windows watchdog:
//! pause/resume around updates, tamper signalling, and health checks.

#![allow(dead_code)] // some helpers are used only from the watchdog bin or release paths

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const SERVICE_NAME: &str = "SafeHomeWatchdog";

/// Machine-wide config written by the installer (ProgramData).
pub fn program_data_dir() -> PathBuf {
    let base = std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("Safe Home")
}

pub fn watchdog_config_path() -> PathBuf {
    program_data_dir().join("watchdog.json")
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
