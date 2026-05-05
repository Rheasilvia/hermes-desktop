# 02 — Tauri Rust sidecar manager (Tasks 19–22)

> Implements spec sections `01-architecture.md §"Process model"` and
> `03-error-handling.md §"Sidecar process crash"`.
>
> Working directory: `desktop/src-tauri/`.

---

## Task 19: `sidecar.rs` — spawn + parse READY + token wiring

**Files:**
- Create: `desktop/src-tauri/src/sidecar.rs`
- Modify: `desktop/src-tauri/src/main.rs`
- Modify: `desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add Cargo dependencies**

In `desktop/src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
tokio = { version = "1.37", features = ["process", "io-util", "rt-multi-thread", "macros", "sync", "time"] }
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }
rand = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
once_cell = "1"
```

- [ ] **Step 2: Implement `sidecar.rs`** (skeleton: spawn + READY only; health/restart added in Task 21–22)

```rust
// src-tauri/src/sidecar.rs
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
fn set_perm_0600(_: &Path) -> Result<()> { Ok(()) }

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
    // Prefer `desktop/backend/.venv/bin/python` if it exists; fall back to system python3.
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

    // Block on READY <port> with a hard ceiling.
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
```

- [ ] **Step 3: Wire into `main.rs`**

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;
#[cfg(test)]
mod sidecar_tests;

use tauri::Manager;

#[tauri::command]
async fn sidecar_info() -> Result<sidecar::SidecarInfo, String> {
    sidecar::current_info()
        .await
        .ok_or_else(|| "sidecar not ready".into())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match sidecar::spawn_dev().await {
                    Ok(info) => {
                        let _ = handle.emit_all("sidecar://ready", info);
                        let h2 = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            sidecar::run_health_probe(h2).await;
                        });
                    }
                    Err(e) => {
                        eprintln!("sidecar failed to start: {e:?}");
                        let _ = handle.emit_all("sidecar://failed", format!("{e}"));
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Build the Tauri shell**

```bash
cd desktop
npm run tauri:dev -- --no-watch &
TAURI_PID=$!
sleep 8
# Manual smoke: in dev console, invoke window.__TAURI__.invoke('sidecar_info').
# Expected: {"base_url": "http://127.0.0.1:<port>", "token": "<hex>"}
kill $TAURI_PID
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/sidecar.rs desktop/src-tauri/src/main.rs desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock
git commit -m "feat(tauri): spawn desktop_backend sidecar and expose sidecar_info"
```

---

## Task 20: Token written to file, never argv

This task is verification: the token must be created via `write_token`
and never appended via `cmd.arg(...)`.

- [ ] **Step 1: Add a Rust unit test**

Create `desktop/src-tauri/src/sidecar_tests.rs`:

```rust
// src-tauri/src/sidecar_tests.rs
#[cfg(test)]
mod tests {
    use super::sidecar;

    #[test]
    fn token_file_path_under_hermes_desktop() {
        std::env::set_var("HERMES_HOME", "/tmp/sidecar-test-home");
        let path = sidecar::token_file();
        let s = path.to_string_lossy();
        assert!(s.ends_with("desktop/sidecar.token"), "got {s}");
    }
}
```

- [ ] **Step 2: Run, expect PASS**

```bash
cd desktop/src-tauri
cargo test sidecar_tests
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/src/sidecar_tests.rs desktop/src-tauri/src/main.rs
git commit -m "test(tauri): assert token file path stays under .hermes/desktop"
```

---

## Task 21: Health probe loop

**Files:**
- Modify: `desktop/src-tauri/src/sidecar.rs`

- [ ] **Step 1: Append health probe to `sidecar.rs`**

```rust
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
```

- [ ] **Step 2: Build**

```bash
cd desktop/src-tauri
cargo build
```

Expected: clean build (`restart_with_backoff` is added in Task 22; if
Task 22 has not landed yet, stub it as `async fn restart_with_backoff(_:
&tauri::AppHandle) -> Result<()> { Ok(()) }` to keep the build green
between commits).

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/src/sidecar.rs
git commit -m "feat(tauri): health probe emits sidecar://unhealthy on 3 failures"
```

---

## Task 22: Restart with exponential backoff + 5/60s cap

**Files:**
- Modify: `desktop/src-tauri/src/sidecar.rs`

- [ ] **Step 1: Replace stub with the real implementation**

```rust
use std::time::Instant;

#[derive(Default)]
struct RestartLedger {
    attempts: Mutex<Vec<Instant>>,
}

static LEDGER: OnceCell<Arc<RestartLedger>> = OnceCell::new();

fn ledger() -> Arc<RestartLedger> {
    LEDGER.get_or_init(|| Arc::new(RestartLedger::default())).clone()
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
```

- [ ] **Step 2: Build & sanity check**

```bash
cd desktop/src-tauri
cargo build
```

Manual smoke: while `npm run tauri:dev` is running, `pkill -f
'desktop_backend'`, then watch for `sidecar://restarted` in the dev
console within ~20s.

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/src/sidecar.rs
git commit -m "feat(tauri): exponential-backoff restart with 5/60s cap"
```

---

## Section checkpoint

After Task 22:
- `cargo build` is clean.
- `npm run tauri:dev` boots the app, sidecar emits `READY <port>`,
  `sidecar_info` returns `{base_url, token}`.
- Killing the sidecar process triggers a respawn within 20s.
