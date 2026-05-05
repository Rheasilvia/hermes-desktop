use anyhow::{anyhow, bail, Context, Result};
use once_cell::sync::OnceCell;
use rand::RngCore;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
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

fn hermes_home() -> PathBuf {
    if let Ok(p) = std::env::var("HERMES_HOME") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    Path::new(&home).join(".hermes")
}

pub(crate) fn token_file() -> PathBuf {
    hermes_home().join("desktop").join("sidecar.token")
}

fn write_token() -> Result<String> {
    let path = token_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    let token = hex_encode(&buf);
    std::fs::write(&path, &token)?;
    set_perm_0600(&path)?;
    Ok(token)
}

#[cfg(unix)]
fn set_perm_0600(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perm = std::fs::metadata(path)?.permissions();
    perm.set_mode(0o600);
    std::fs::set_permissions(path, perm)?;
    Ok(())
}

#[cfg(not(unix))]
fn set_perm_0600(_: &Path) -> Result<()> {
    Ok(())
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

fn dev_python() -> PathBuf {
    let venv = Path::new("../backend/.venv/bin/python");
    if venv.exists() {
        venv.to_path_buf()
    } else {
        PathBuf::from("python3")
    }
}

pub async fn spawn_dev() -> Result<SidecarInfo> {
    let token = write_token()?;
    let mut cmd = Command::new(dev_python());
    cmd.arg("-m").arg("desktop_backend");
    cmd.current_dir("../backend");
    cmd.env("HERMES_HOME", hermes_home());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let mut child = cmd.spawn().context("failed to spawn desktop_backend")?;

    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
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
    .map_err(|_| anyhow!("sidecar startup timeout"))??;

    let info = SidecarInfo {
        base_url: format!("http://127.0.0.1:{port}"),
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

pub async fn run_health_probe(handle: tauri::AppHandle) {
    use tauri::Manager;
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
            let _ = handle.emit_all("sidecar://unhealthy", ());
            consecutive_failures = 0;
            if let Err(e) = restart_with_backoff(&handle).await {
                let _ = handle.emit_all("sidecar://failed", format!("{e}"));
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
    use tauri::Manager;
    // Hard cap: 5 restarts in 60 seconds.
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

    let info = spawn_dev().await?;
    let _ = handle.emit_all("sidecar://restarted", info);
    Ok(())
}
