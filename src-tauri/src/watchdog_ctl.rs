//! Shared helpers so the main app can pause/resume the Windows watchdog service
//! around updates, and clear the pause marker on normal launch.

#![allow(dead_code)] // pause helpers are used from release-only update paths

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

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
