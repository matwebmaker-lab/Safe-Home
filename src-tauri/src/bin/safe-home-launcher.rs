//! Thin public entry point (`safe-home.exe`).
//!
//! Starts the real lock UI (`sh-host.exe`) from the same folder, then exits.
//! Start Menu / desktop shortcuts point here so the obvious name is not the
//! process that stays running.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;

fn main() {
    let Ok(self_exe) = std::env::current_exe() else {
        std::process::exit(1);
    };
    let Some(dir) = self_exe.parent() else {
        std::process::exit(1);
    };
    let host = dir.join("sh-host.exe");
    if !host.is_file() {
        std::process::exit(1);
    }

    let mut cmd = Command::new(&host);
    cmd.current_dir(dir);
    cmd.args(std::env::args_os().skip(1));

    match cmd.spawn() {
        Ok(_) => {}
        Err(_) => std::process::exit(1),
    }
}
