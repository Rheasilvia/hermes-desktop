use anyhow::{bail, Result};
#[cfg(not(debug_assertions))]
use anyhow::Context;
use tauri::Emitter;
use once_cell::sync::OnceCell;
use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::process::Child;
use tokio::sync::Mutex;
use tokio::time::timeout;

#[derive(Clone, Debug, Serialize)]
pub struct SidecarInfo {
    pub base_url: String,
    pub token: String,
}

#[derive(Default)]
pub struct SidecarState {
    info: Mutex<Option<SidecarInfo>>,
    child: Mutex<Option<Child>>,
}

pub static SIDECAR: OnceCell<Arc<SidecarState>> = OnceCell::new();

pub fn state() -> Arc<SidecarState> {
    SIDECAR
        .get_or_init(|| Arc::new(SidecarState::default()))
        .clone()
}

/// Kill any existing desktop_backend process to ensure a clean start.
fn kill_backend_process() {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let _ = std::process::Command::new("pkill")
            .arg("-f")
            .arg("desktop_backend")
            .output();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/FI", "IMAGENAME eq python.exe"])
            .output();
    }
}

/// Dev mode: spawn the backend via `uv run` if not already running.
/// Reads HERMES_BACKEND_URL (default: http://127.0.0.1:18080)
/// and HERMES_BACKEND_TOKEN from env vars.
pub async fn spawn_dev() -> Result<SidecarInfo> {
    let base_url = std::env::var("HERMES_BACKEND_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:18080".into());
    let token = std::env::var("HERMES_BACKEND_TOKEN")
        .or_else(|_| std::env::var("DESKTOP_BACKEND_TOKEN"))
        .unwrap_or_else(|_| "dev-secret".into());
    let port = std::env::var("DESKTOP_BACKEND_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(18080);

    // Check if backend is already running — kill it to ensure a clean start
    let health_url = format!("{}/desktop/api/health", base_url);
    if let Ok(Ok(resp)) = timeout(Duration::from_secs(2), reqwest::get(&health_url)).await {
        if resp.status().is_success() {
            kill_backend_process();
            // Give the old process time to release the port
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    // Backend not running — start it via uv
    let mut cmd = Command::new("uv");
    cmd.arg("run");
    cmd.arg("--directory");
    // Tauri dev runs from src-tauri/, backend is in the parent desktop/ dir
    cmd.arg("../backend");
    cmd.arg("python");
    cmd.arg("-m");
    cmd.arg("desktop_backend");
    cmd.env("DESKTOP_BACKEND_PORT", port.to_string());
    cmd.env("DESKTOP_BACKEND_TOKEN", &token);
    cmd.env("HERMES_BACKEND_URL", &base_url);
    use std::process::Stdio;
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to spawn backend: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("no stdout"))?;
    let mut reader = BufReader::new(stdout).lines();
    let actual_port = timeout(Duration::from_secs(30), async {
        while let Some(line) = reader.next_line().await? {
            if let Some(rest) = line.strip_prefix("READY ") {
                return Ok::<u16, anyhow::Error>(rest.trim().parse()?);
            }
        }
        bail!("backend exited before READY")
    })
    .await
    .map_err(|_| anyhow::anyhow!("backend startup timeout"))??;

    let info = SidecarInfo {
        base_url: format!("http://127.0.0.1:{actual_port}"),
        token,
    };
    let s = state();
    *s.info.lock().await = Some(info.clone());
    *s.child.lock().await = Some(child);
    Ok(info)
}

pub async fn current_info() -> Option<SidecarInfo> {
    state().info.lock().await.clone()
}

/// Take the child process handle (used for cleanup on exit).
pub async fn take_child() -> Option<Child> {
    state().child.lock().await.take()
}

pub async fn run_health_probe(handle: tauri::AppHandle) {
    let mut consecutive_failures = 0u32;
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let info = match current_info().await {
            Some(i) => i,
            None => continue,
        };
        let url = format!("{}/desktop/api/health", info.base_url);
        let ok = match timeout(Duration::from_secs(1), reqwest::get(&url)).await {
            Ok(Ok(resp)) => resp.status().is_success(),
            _ => false,
        };
        if ok {
            consecutive_failures = 0;
            continue;
        }
        consecutive_failures += 1;
        if consecutive_failures >= 3 {
            let _ = handle.emit("sidecar://unhealthy", ());
            consecutive_failures = 0;
            if let Err(e) = restart_with_backoff(&handle).await {
                let _ = handle.emit("sidecar://failed", format!("{e}"));
            }
        }
    }
}

#[derive(Default)]
struct RestartLedger {
    attempts: Mutex<Vec<Instant>>,
}

static LEDGER: OnceCell<Arc<RestartLedger>> = OnceCell::new();

fn ledger() -> Arc<RestartLedger> {
    LEDGER
        .get_or_init(|| Arc::new(RestartLedger::default()))
        .clone()
}

async fn restart_with_backoff(handle: &tauri::AppHandle) -> Result<()> {
    {
        let l = ledger();
        let mut attempts = l.attempts.lock().await;
        let cutoff = Instant::now() - Duration::from_secs(60);
        attempts.retain(|t| *t > cutoff);
        if attempts.len() >= 5 {
            bail!("restart cap hit (5 in 60s)");
        }
        attempts.push(Instant::now());
    }

    if let Some(mut child) = state().child.lock().await.take() {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    *state().info.lock().await = None;

    let attempt = ledger().attempts.lock().await.len() as u32;
    let backoff = std::cmp::min(2u64.saturating_pow(attempt), 30);
    tokio::time::sleep(Duration::from_secs(backoff)).await;

    let info = spawn(handle.clone()).await?;
    let _ = handle.emit("sidecar://restarted", info);
    Ok(())
}

#[cfg(not(debug_assertions))]
fn release_binary(_handle: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    // Tauri strips the arch suffix and bundles externalBin alongside the main
    // executable in Contents/MacOS/ (macOS) or next to the .exe (Windows/Linux).
    // BaseDirectory::Executable is unreliable across platforms, so resolve from
    // the current executable's directory directly.
    let current = std::env::current_exe().context("locate current executable")?;
    let dir = current
        .parent()
        .ok_or_else(|| anyhow::anyhow!("current_exe has no parent directory"))?;
    let exe_name = if cfg!(windows) {
        "desktop_backend.exe"
    } else {
        "desktop_backend"
    };
    let candidate = dir.join(exe_name);
    if !candidate.exists() {
        bail!(
            "sidecar binary not found at {} (current_exe={})",
            candidate.display(),
            current.display()
        );
    }
    Ok(candidate)
}

#[cfg(not(debug_assertions))]
fn hermes_home() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("HERMES_HOME") {
        return std::path::PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".hermes")
}

pub async fn spawn(handle: tauri::AppHandle) -> Result<SidecarInfo> {
    #[cfg(debug_assertions)]
    {
        let _ = handle;
        spawn_dev().await
    }

    #[cfg(not(debug_assertions))]
    {
        let bin = release_binary(&handle)?;
        let token = std::env::var("HERMES_BACKEND_TOKEN").unwrap_or_default();
        let port = std::env::var("DESKTOP_BACKEND_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(18081);
        let mut cmd = Command::new(bin);
        cmd.env("HERMES_HOME", hermes_home());
        cmd.env("DESKTOP_BACKEND_PORT", port.to_string());
        cmd.env("DESKTOP_BACKEND_TOKEN", &token);
        use std::process::Stdio;
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        let mut child = cmd.spawn().context("failed to spawn sidecar")?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("no stdout"))?;
        let mut reader = BufReader::new(stdout).lines();
        let port = timeout(Duration::from_secs(30), async {
            while let Some(line) = reader.next_line().await? {
                if let Some(rest) = line.strip_prefix("READY ") {
                    return Ok::<u16, anyhow::Error>(rest.trim().parse()?);
                }
            }
            bail!("sidecar exited before READY")
        })
        .await
        .map_err(|_| anyhow::anyhow!("sidecar startup timeout"))??;

        let info = SidecarInfo {
            base_url: format!("http://127.0.0.1:{port}"),
            token,
        };
        let s = state();
        *s.info.lock().await = Some(info.clone());
        *s.child.lock().await = Some(child);
        Ok(info)
    }
}
