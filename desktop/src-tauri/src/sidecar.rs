use anyhow::{bail, Result};
#[cfg(not(debug_assertions))]
use anyhow::Context;
use tauri::Emitter;
use once_cell::sync::OnceCell;
use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
#[cfg(not(debug_assertions))]
use tokio::io::{AsyncBufReadExt, BufReader};
#[cfg(not(debug_assertions))]
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

/// Dev mode: connect to a pre-running backend.
/// Reads HERMES_BACKEND_URL (default: http://127.0.0.1:18080)
/// and HERMES_BACKEND_TOKEN from env vars.
pub async fn spawn_dev() -> Result<SidecarInfo> {
    let base_url = std::env::var("HERMES_BACKEND_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:18080".into());
    let token = std::env::var("HERMES_BACKEND_TOKEN").unwrap_or_default();
    let info = SidecarInfo { base_url, token };
    let s = state();
    *s.info.lock().await = Some(info.clone());
    Ok(info)
}

pub async fn current_info() -> Option<SidecarInfo> {
    state().info.lock().await.clone()
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
fn release_binary(handle: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    use std::path::PathBuf;
    use std::process::Stdio;
    use tauri::Manager;
    let resolver = handle.path();
    let res = resolver
        .resolve(
            "desktop_backend/desktop_backend",
            tauri::path::BaseDirectory::Resource,
        )
        .context("resolve sidecar binary")?;
    Ok(res)
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
        let port = timeout(Duration::from_secs(5), async {
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
