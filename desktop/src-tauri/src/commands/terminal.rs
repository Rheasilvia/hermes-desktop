use once_cell::sync::Lazy;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

static TERMINAL_SESSION: Lazy<Mutex<Option<TerminalSession>>> = Lazy::new(|| Mutex::new(None));

#[derive(Debug, Serialize, Clone)]
pub struct TerminalStartResult {
    pub id: String,
    pub pid: Option<u32>,
    pub shell: String,
    pub cwd: String,
    pub reused: bool,
}

#[derive(Debug, Serialize, Clone)]
struct TerminalDataEvent {
    id: String,
    // Raw bytes from the PTY reader. We intentionally avoid UTF-8 decoding
    // here: multi-byte sequences (CJK, emoji) routinely span read-chunk
    // boundaries and `String::from_utf8_lossy` would corrupt them. The
    // frontend reconstructs a `Uint8Array` and feeds it straight to xterm.
    data: Vec<u8>,
}

#[derive(Debug, Serialize, Clone)]
struct TerminalExitEvent {
    id: String,
    code: u32,
    signal: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct TerminalErrorEvent {
    id: String,
    error: String,
}

struct TerminalSession {
    id: String,
    pid: Option<u32>,
    shell: String,
    cwd: String,
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

impl TerminalSession {
    fn start_result(&self, reused: bool) -> TerminalStartResult {
        TerminalStartResult {
            id: self.id.clone(),
            pid: self.pid,
            shell: self.shell.clone(),
            cwd: self.cwd.clone(),
            reused,
        }
    }
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<TerminalStartResult, String> {
    {
        let guard = TERMINAL_SESSION
            .lock()
            .map_err(|_| "terminal session lock poisoned".to_string())?;
        if let Some(session) = guard.as_ref() {
            return Ok(session.start_result(true));
        }
    }

    let cwd_path = resolve_cwd(cwd)?;
    let cwd_string = cwd_path.to_string_lossy().to_string();
    let shell = default_shell();
    let size = sanitize_size(cols, rows);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("failed to open terminal: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to open terminal reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to open terminal writer: {e}"))?;
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(cwd_path.as_os_str());
    // Spawn the shell as a proper interactive session (mirrors the Electron
    // reference in apps/desktop/electron/main.cjs::posixShellSpec). Without
    // these flags zsh/bash skip rc loading and the prompt looks wrong.
    for arg in shell_args(&shell) {
        cmd.arg(arg);
    }
    scrub_terminal_env(&mut cmd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Hermes");
    cmd.env("HERMES_DESKTOP_TERMINAL", "1");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to start terminal shell: {e}"))?;
    let pid = child.process_id();
    let killer = child.clone_killer();
    let id = format!("terminal-{}", pid.unwrap_or_else(rand::random::<u32>));
    let writer = Arc::new(Mutex::new(writer));

    let session = TerminalSession {
        id: id.clone(),
        pid,
        shell,
        cwd: cwd_string,
        master: pair.master,
        writer,
        killer,
    };
    let result = session.start_result(false);
    let mut guard = TERMINAL_SESSION
        .lock()
        .map_err(|_| "terminal session lock poisoned".to_string())?;
    *guard = Some(session);
    drop(guard);

    spawn_reader(app.clone(), id.clone(), reader);
    spawn_waiter(app, id, child);
    Ok(result)
}

#[tauri::command]
pub fn terminal_write(id: String, data: Vec<u8>) -> Result<(), String> {
    let writer = {
        let guard = TERMINAL_SESSION
            .lock()
            .map_err(|_| "terminal session lock poisoned".to_string())?;
        let session = guard
            .as_ref()
            .ok_or_else(|| "terminal is not running".to_string())?;
        if session.id != id {
            return Err("terminal session not found".into());
        }
        session.writer.clone()
    };

    let mut writer = writer
        .lock()
        .map_err(|_| "terminal writer lock poisoned".to_string())?;
    writer
        .write_all(&data)
        .and_then(|_| writer.flush())
        .map_err(|e| format!("terminal write failed: {e}"))
}

#[tauri::command]
pub fn terminal_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let guard = TERMINAL_SESSION
        .lock()
        .map_err(|_| "terminal session lock poisoned".to_string())?;
    let session = guard
        .as_ref()
        .ok_or_else(|| "terminal is not running".to_string())?;
    if session.id != id {
        return Err("terminal session not found".into());
    }
    session
        .master
        .resize(sanitize_size(cols, rows))
        .map_err(|e| format!("terminal resize failed: {e}"))
}

#[tauri::command]
pub fn terminal_stop(id: String) -> Result<(), String> {
    let Some(mut session) = ({
        let mut guard = TERMINAL_SESSION
            .lock()
            .map_err(|_| "terminal session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Ok(());
        };
        if session.id != id {
            return Err("terminal session not found".into());
        }
        guard.take()
    }) else {
        return Ok(());
    };

    session
        .killer
        .kill()
        .map_err(|e| format!("terminal stop failed: {e}"))
}

pub fn terminal_shutdown() {
    let mut session = {
        let Ok(mut guard) = TERMINAL_SESSION.lock() else {
            return;
        };
        guard.take()
    };

    if let Some(session) = session.as_mut() {
        let _ = session.killer.kill();
    }
}

fn sanitize_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(2, 500),
        rows: rows.clamp(2, 200),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn resolve_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    let path = match cwd.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    }) {
        Some(path) => path,
        None => std::env::current_dir()
            .map_err(|e| format!("failed to resolve current directory: {e}"))?,
    };
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("terminal cwd not found: {e}"))?;
    if !canonical.is_dir() {
        return Err("terminal cwd is not a directory".into());
    }
    Ok(canonical)
}

fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "powershell.exe".into())
    } else {
        std::env::var("SHELL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "/bin/sh".into())
    }
}

/// Pick interactive flags for the resolved shell, by basename. Mirrors the
/// Electron reference (`apps/desktop/electron/main.cjs::shellSpecFor`): zsh/bash
/// get `-il` (interactive + login, so rc files load and the prompt is normal),
/// other POSIX shells get `-i`, PowerShell drops its logo banner, cmd needs
/// nothing.
fn shell_args(shell_path: &str) -> Vec<String> {
    // Extract the basename portably: `Path::file_name()` is platform-specific
    // (treats `\` as a separator only on Windows), but shell paths cross
    // platforms in tests and env vars, so split on both separators by hand.
    let basename = shell_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_lowercase();

    if basename.starts_with("pwsh") || basename.starts_with("powershell") {
        vec!["-NoLogo".into()]
    } else if basename.starts_with("cmd") {
        Vec::new()
    } else if basename.contains("zsh") || basename.contains("bash") {
        vec!["-il".into()]
    } else {
        vec!["-i".into()]
    }
}

/// Strip env vars the desktop process inherited (commonly via `npm run tauri:dev`
/// or a non-tty launcher) that would leak into the user's interactive shell or
/// confuse color detection. Mirrors `terminalShellEnv` in the Electron
/// reference. `CommandBuilder` inherits the parent env by default; `env_remove`
/// deletes from that inherited set.
fn scrub_terminal_env(cmd: &mut CommandBuilder) {
    for key in ["NO_COLOR", "FORCE_COLOR", "COLORFGBG"] {
        cmd.env_remove(key);
    }
    // npm-scoped vars (prefix, package metadata) make nvm/proto warn loudly in
    // a user shell; drop the whole family.
    let inherited_keys: Vec<String> = std::env::vars().map(|(k, _)| k).collect();
    for key in inherited_keys {
        if key == "npm_config_prefix"
            || key.starts_with("npm_config_")
            || key.starts_with("npm_package_")
        {
            cmd.env_remove(&key);
        }
    }
}

fn spawn_reader(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buf = [0_u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app.emit(
                        "terminal_data",
                        TerminalDataEvent {
                            id: id.clone(),
                            data: buf[..n].to_vec(),
                        },
                    );
                }
                Err(e) => {
                    let _ = app.emit(
                        "terminal_error",
                        TerminalErrorEvent {
                            id: id.clone(),
                            error: format!("terminal read failed: {e}"),
                        },
                    );
                    break;
                }
            }
        }
    });
}

fn spawn_waiter(app: AppHandle, id: String, mut child: Box<dyn portable_pty::Child + Send + Sync>) {
    thread::spawn(move || {
        match child.wait() {
            Ok(status) => {
                let _ = app.emit(
                    "terminal_exit",
                    TerminalExitEvent {
                        id: id.clone(),
                        code: status.exit_code(),
                        signal: status.signal().map(str::to_owned),
                    },
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "terminal_error",
                    TerminalErrorEvent {
                        id: id.clone(),
                        error: format!("terminal wait failed: {e}"),
                    },
                );
            }
        }
        if let Ok(mut guard) = TERMINAL_SESSION.lock() {
            if guard.as_ref().map(|session| session.id.as_str()) == Some(id.as_str()) {
                *guard = None;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_size_clamps_unusable_dimensions() {
        let size = sanitize_size(0, 1);
        assert_eq!(size.cols, 2);
        assert_eq!(size.rows, 2);

        let size = sanitize_size(999, 999);
        assert_eq!(size.cols, 500);
        assert_eq!(size.rows, 200);
    }

    #[test]
    fn resolve_cwd_rejects_missing_directory() {
        let err = resolve_cwd(Some("/definitely/not/a/hermes/terminal/cwd".into()))
            .expect_err("missing cwd should fail");
        assert!(err.contains("terminal cwd not found"));
    }

    #[test]
    fn shell_args_picks_interactive_flags_by_family() {
        // zsh/bash get -il (interactive + login) so rc files load.
        assert_eq!(shell_args("/bin/zsh"), vec!["-il"]);
        assert_eq!(shell_args("/bin/bash"), vec!["-il"]);
        assert_eq!(shell_args("/usr/local/bin/zsh-5.8"), vec!["-il"]);
        // Other POSIX shells (fish, sh) get bare -i.
        assert_eq!(shell_args("/usr/bin/fish"), vec!["-i"]);
        assert_eq!(shell_args("/bin/sh"), vec!["-i"]);
        // PowerShell drops its logo banner; cmd needs nothing.
        assert_eq!(shell_args("/usr/bin/pwsh"), vec!["-NoLogo"]);
        assert_eq!(shell_args("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"), vec!["-NoLogo"]);
        assert_eq!(shell_args("C:\\Windows\\System32\\cmd.exe"), Vec::<String>::new());
    }

    #[cfg(unix)]
    #[test]
    fn pty_spawn_write_resize_smoke() {
        use std::io::{Read, Write};
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(sanitize_size(80, 24))
            .expect("pty should open");
        pair.master
            .resize(sanitize_size(100, 30))
            .expect("pty should resize");
        let mut reader = pair.master.try_clone_reader().expect("reader should open");
        let mut writer = pair.master.take_writer().expect("writer should open");
        let mut cmd = CommandBuilder::new(default_shell());
        cmd.env("TERM", "xterm-256color");
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .expect("shell should spawn in pty");
        let (tx, rx) = mpsc::channel::<String>();
        thread::spawn(move || {
            let mut buf = [0_u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let _ = tx.send(String::from_utf8_lossy(&buf[..n]).to_string());
                    }
                }
            }
        });

        writer
            .write_all(b"printf hermes_terminal_smoke\r\n")
            .expect("shell input should write");
        writer.flush().expect("shell input should flush");

        let deadline = Instant::now() + Duration::from_secs(3);
        let mut output = String::new();
        while Instant::now() < deadline && !output.contains("hermes_terminal_smoke") {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) {
                output.push_str(&chunk);
            }
        }

        writer
            .write_all(b"exit\r\n")
            .expect("shell exit should write");
        writer.flush().expect("shell exit should flush");
        drop(writer);
        let _ = child.kill();
        let _ = child.wait();

        assert!(output.contains("hermes_terminal_smoke"));
    }
}
