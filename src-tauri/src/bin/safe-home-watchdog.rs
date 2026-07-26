//! Windows service that restarts Safe Home if the host process exits,
//! and restores `sh-host.exe` / `safe-home.exe` from sealed ProgramData copies
//! if they were deleted.
//!
//! Registered as `SafeHomeWatchdog`. Runs as LocalSystem and launches the
//! GUI into the designated interactive user session (Session 0 isolation).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
#[path = "../watchdog_ctl.rs"]
mod watchdog_ctl;

#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    watchdog::run()
}

#[cfg(not(windows))]
fn main() {
    eprintln!("safe-home-watchdog is only supported on Windows.");
    std::process::exit(1);
}

#[cfg(windows)]
mod watchdog {
    use serde::Deserialize;
    use std::ffi::OsStr;
    use std::fs;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use windows_service::service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::{define_windows_service, service_dispatcher};
    use windows_sys::Win32::Foundation::{
        CloseHandle, LocalFree, FALSE, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Security::Authorization::ConvertStringSidToSidW;
    use windows_sys::Win32::Security::{
        DuplicateTokenEx, EqualSid, GetTokenInformation, SecurityImpersonation, TokenPrimary,
        TokenUser, TOKEN_ALL_ACCESS, TOKEN_USER,
    };
    use windows_sys::Win32::System::Environment::{
        CreateEnvironmentBlock, DestroyEnvironmentBlock,
    };
    use windows_sys::Win32::System::ProcessStatus::{K32EnumProcesses, K32GetModuleFileNameExW};
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSEnumerateSessionsW, WTSFreeMemory, WTSQueryUserToken, WTSActive,
        WTS_CURRENT_SERVER_HANDLE, WTS_SESSION_INFOW,
    };
    use windows_sys::Win32::System::Threading::{
        CreateProcessAsUserW, OpenProcess, CREATE_NEW_CONSOLE, CREATE_UNICODE_ENVIRONMENT,
        PROCESS_INFORMATION, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ, STARTUPINFOW,
    };

    use crate::watchdog_ctl;

    const SERVICE_NAME: &str = "SafeHomeWatchdog";
    /// Poll often so a Task Manager kill is followed by an almost immediate relaunch.
    const POLL_INTERVAL: Duration = Duration::from_millis(500);
    const SERVICE_TYPE: ServiceType = ServiceType::OWN_PROCESS;

    static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

    #[derive(Debug, Deserialize)]
    struct WatchdogConfig {
        target_user_sid: String,
        exe_path: String,
    }

    define_windows_service!(ffi_service_main, service_main);

    pub fn run() -> Result<(), Box<dyn std::error::Error>> {
        service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
        Ok(())
    }

    fn service_main(_args: Vec<std::ffi::OsString>) {
        if let Err(e) = run_service() {
            log_error(&format!("service failed: {e}"));
        }
    }

    fn run_service() -> Result<(), Box<dyn std::error::Error>> {
        let (shutdown_tx, shutdown_rx) = mpsc::channel();

        let event_handler = move |control_event| -> ServiceControlHandlerResult {
            match control_event {
                ServiceControl::Stop | ServiceControl::Shutdown => {
                    STOP_REQUESTED.store(true, Ordering::SeqCst);
                    let _ = shutdown_tx.send(());
                    ServiceControlHandlerResult::NoError
                }
                ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
                _ => ServiceControlHandlerResult::NotImplemented,
            }
        };

        let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

        status_handle.set_service_status(ServiceStatus {
            service_type: SERVICE_TYPE,
            current_state: ServiceState::Running,
            controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        })?;

        // Only treat running→missing as a kill (not first boot before Safe Home starts).
        let mut saw_running = false;
        // Avoid hammering CreateProcessAsUser if launch keeps failing.
        let mut launch_backoff_until: Option<SystemTime> = None;

        loop {
            if STOP_REQUESTED.load(Ordering::SeqCst) {
                break;
            }

            match shutdown_rx.recv_timeout(POLL_INTERVAL) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }

            if is_paused() {
                saw_running = false;
                launch_backoff_until = None;
                continue;
            }

            // Keep the hardened PIN/settings seal in sync with the host's pending copy.
            let _ = watchdog_ctl::sync_sealed_config_from_pending();

            let Some(cfg) = load_config() else {
                continue;
            };

            let exe = PathBuf::from(&cfg.exe_path);

            if is_process_running(&exe) {
                saw_running = true;
                launch_backoff_until = None;
                continue;
            }

            // Process gone — restore host/launcher from sealed copies if deleted,
            // then relaunch.
            match ensure_binaries_present(&exe) {
                Ok(restored) => {
                    if restored {
                        watchdog_ctl::mark_tamper();
                        log_error(
                            "Restored Safe Home binary from sealed payload — marking tamper",
                        );
                        saw_running = false;
                    }
                }
                Err(e) => {
                    log_error(&format!("restore failed: {e}"));
                    continue;
                }
            }

            if !exe.is_file() {
                continue;
            }

            if let Some(until) = launch_backoff_until {
                if SystemTime::now() < until {
                    continue;
                }
            }

            // Process was alive earlier in this service session, then disappeared → kill.
            // Also catch "both killed, then admin started only the watchdog": heartbeat
            // is stale while Windows uptime is high.
            if saw_running || watchdog_ctl::detect_unclean_exit() {
                watchdog_ctl::mark_tamper();
                log_error("Safe Home missing unexpectedly — marking tamper and relaunching");
                saw_running = false;
            }

            match launch_in_user_session(&cfg.target_user_sid, &exe) {
                Ok(()) => {
                    // Give the new process time to show up in the process list
                    // before we attempt another CreateProcessAsUser.
                    launch_backoff_until =
                        Some(SystemTime::now() + Duration::from_secs(3));
                }
                Err(e) => {
                    log_error(&format!("launch failed: {e}"));
                    launch_backoff_until =
                        Some(SystemTime::now() + Duration::from_secs(2));
                }
            }
        }

        status_handle.set_service_status(ServiceStatus {
            service_type: SERVICE_TYPE,
            current_state: ServiceState::Stopped,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        })?;

        Ok(())
    }

    fn program_data_dir() -> PathBuf {
        watchdog_ctl::program_data_dir()
    }

    /// Ensure host + Start Menu launcher exist, restoring from sealed copies if deleted.
    /// Returns Ok(true) when at least one file was restored.
    fn ensure_binaries_present(host_exe: &Path) -> Result<bool, String> {
        let mut restored = false;

        match ensure_file_from_seal(host_exe, &watchdog_ctl::sealed_host_path()) {
            Ok(true) => restored = true,
            Ok(false) => {}
            Err(e) => return Err(format!("host: {e}")),
        }

        let launcher = watchdog_ctl::launcher_path_beside_host(host_exe);
        // Launcher restore is best-effort — host is enough to keep the lock running.
        match ensure_file_from_seal(&launcher, &watchdog_ctl::sealed_launcher_path()) {
            Ok(true) => restored = true,
            Ok(false) => {}
            Err(e) => log_error(&format!("launcher restore failed: {e}")),
        }

        Ok(restored)
    }

    /// Copy `sealed` → `target` when the install-dir file is missing.
    /// Returns Ok(true) if a restore write happened.
    fn ensure_file_from_seal(target: &Path, sealed: &Path) -> Result<bool, String> {
        if target.is_file() {
            return Ok(false);
        }
        if !sealed.is_file() {
            return Err(format!("sealed copy missing: {}", sealed.display()));
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
        }

        let tmp = target.with_extension("exe.restoring");
        fs::copy(sealed, &tmp).map_err(|e| format!("copy sealed→tmp: {e}"))?;
        fs::rename(&tmp, target).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename tmp→target: {e}")
        })?;

        Ok(true)
    }

    fn load_config() -> Option<WatchdogConfig> {
        let path = program_data_dir().join("watchdog.json");
        let data = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&data).ok()
    }

    fn is_paused() -> bool {
        let path = program_data_dir().join("watchdog.pause");
        let Ok(contents) = std::fs::read_to_string(&path) else {
            return false;
        };
        let trimmed = contents.trim();
        if trimmed.is_empty() {
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

    fn log_error(msg: &str) {
        let dir = program_data_dir();
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("watchdog.log");
        let line = format!(
            "{} {}\n",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            msg
        );
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(line.as_bytes())
            });
    }

    fn is_process_running(exe: &Path) -> bool {
        let target = normalize_path(exe);
        let mut pids = vec![0u32; 1024];
        let mut bytes_needed = 0u32;

        loop {
            let ok = unsafe {
                K32EnumProcesses(
                    pids.as_mut_ptr(),
                    (pids.len() * std::mem::size_of::<u32>()) as u32,
                    &mut bytes_needed,
                )
            };
            if ok == 0 {
                return false;
            }
            let count = (bytes_needed as usize) / std::mem::size_of::<u32>();
            if count < pids.len() {
                pids.truncate(count);
                break;
            }
            pids.resize(pids.len() * 2, 0);
        }

        for pid in pids {
            if pid == 0 {
                continue;
            }
            let handle =
                unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid) };
            if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                continue;
            }

            let mut buf = [0u16; 1024];
            let len = unsafe {
                K32GetModuleFileNameExW(
                    handle,
                    std::ptr::null_mut(),
                    buf.as_mut_ptr(),
                    buf.len() as u32,
                )
            };
            unsafe {
                CloseHandle(handle);
            }
            if len == 0 {
                continue;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            if normalize_path(Path::new(&path)) == target {
                return true;
            }
        }
        false
    }

    fn normalize_path(path: &Path) -> String {
        path.to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase()
    }

    fn to_wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    fn launch_in_user_session(target_sid: &str, exe: &Path) -> Result<(), String> {
        let session_id = find_session_for_sid(target_sid)?;

        let mut user_token: HANDLE = std::ptr::null_mut();
        let ok = unsafe { WTSQueryUserToken(session_id, &mut user_token) };
        if ok == 0 {
            return Err(format!(
                "WTSQueryUserToken failed for session {session_id}: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut primary = user_token;
        let mut duplicated: HANDLE = std::ptr::null_mut();
        let dup_ok = unsafe {
            DuplicateTokenEx(
                user_token,
                TOKEN_ALL_ACCESS,
                std::ptr::null(),
                SecurityImpersonation,
                TokenPrimary,
                &mut duplicated,
            )
        };
        if dup_ok != 0 {
            primary = duplicated;
            unsafe {
                CloseHandle(user_token);
            }
        }

        let mut env: *mut std::ffi::c_void = std::ptr::null_mut();
        let env_ok = unsafe { CreateEnvironmentBlock(&mut env, primary, FALSE) };
        if env_ok == 0 {
            unsafe {
                CloseHandle(primary);
            }
            return Err(format!(
                "CreateEnvironmentBlock failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut exe_wide = to_wide(exe.as_os_str());
        let mut dir_wide = exe.parent().map(|p| to_wide(p.as_os_str()));
        let dir_ptr = dir_wide
            .as_mut()
            .map(|v| v.as_mut_ptr())
            .unwrap_or(std::ptr::null_mut());

        let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        let mut process_info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

        let created = unsafe {
            CreateProcessAsUserW(
                primary,
                exe_wide.as_mut_ptr(),
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                FALSE,
                CREATE_UNICODE_ENVIRONMENT | CREATE_NEW_CONSOLE,
                env,
                dir_ptr,
                &mut startup,
                &mut process_info,
            )
        };

        unsafe {
            DestroyEnvironmentBlock(env);
            CloseHandle(primary);
        }

        if created == 0 {
            return Err(format!(
                "CreateProcessAsUser failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        unsafe {
            CloseHandle(process_info.hThread);
            CloseHandle(process_info.hProcess);
        }

        Ok(())
    }

    fn find_session_for_sid(target_sid: &str) -> Result<u32, String> {
        let mut sid_wide = to_wide(OsStr::new(target_sid));
        let mut target_sid_ptr = std::ptr::null_mut();
        let ok = unsafe { ConvertStringSidToSidW(sid_wide.as_mut_ptr(), &mut target_sid_ptr) };
        if ok == 0 || target_sid_ptr.is_null() {
            return Err(format!(
                "ConvertStringSidToSidW failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut session_info: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
        let mut count: u32 = 0;
        let enum_ok = unsafe {
            WTSEnumerateSessionsW(
                WTS_CURRENT_SERVER_HANDLE,
                0,
                1,
                &mut session_info,
                &mut count,
            )
        };
        if enum_ok == 0 || session_info.is_null() {
            unsafe {
                LocalFree(target_sid_ptr as _);
            }
            return Err(format!(
                "WTSEnumerateSessionsW failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut found: Option<u32> = None;
        for i in 0..count as isize {
            let info = unsafe { &*session_info.offset(i) };
            if info.State != WTSActive {
                continue;
            }
            let session_id = info.SessionId;
            let mut token: HANDLE = std::ptr::null_mut();
            let tok_ok = unsafe { WTSQueryUserToken(session_id, &mut token) };
            if tok_ok == 0 {
                continue;
            }

            let matches = token_sid_equals(token, target_sid_ptr);
            unsafe {
                CloseHandle(token);
            }
            if matches {
                found = Some(session_id);
                break;
            }
        }

        unsafe {
            WTSFreeMemory(session_info as *mut _);
            LocalFree(target_sid_ptr as _);
        }

        found.ok_or_else(|| format!("no active session for SID {target_sid}"))
    }

    fn token_sid_equals(token: HANDLE, target_sid: *mut std::ffi::c_void) -> bool {
        let mut needed = 0u32;
        unsafe {
            GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        }
        if needed == 0 {
            return false;
        }
        let mut buf = vec![0u8; needed as usize];
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buf.as_mut_ptr() as *mut _,
                needed,
                &mut needed,
            )
        };
        if ok == 0 {
            return false;
        }
        let user = unsafe { &*(buf.as_ptr() as *const TOKEN_USER) };
        unsafe { EqualSid(user.User.Sid, target_sid) != 0 }
    }
}
