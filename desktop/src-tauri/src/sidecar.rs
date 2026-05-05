use anyhow::{anyhow, bail, Context, Result};
use once_cell::sync::OnceCell;
use rand::RngCore;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
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
