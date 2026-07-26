//! Session asset persistence.
//!
//! Image attachments from the clipboard land in the system temp dir, which the
//! OS may purge. To make attachments survive a restart, the frontend asks the
//! Rust layer to copy the source file into a durable per-session assets dir
//! under HERMES_HOME before sending. The persisted path is then carried through
//! `user_display_parts` (which already round-trips through the sidecar DB), so
//! the image is reconstructed on reload.

use std::path::{Path, PathBuf};

fn hermes_home() -> Result<PathBuf, String> {
    if let Ok(custom_home) = std::env::var("HERMES_HOME") {
        return Ok(PathBuf::from(custom_home));
    }
    let home_dir = std::env::var("HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from))
        .map_err(|_| "Failed to get home directory".to_string())?;
    Ok(home_dir.join(".hermes"))
}

fn session_assets_dir(session_id: &str) -> Result<PathBuf, String> {
    let dir = hermes_home()?.join("sessions").join(session_id).join("assets");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create session assets dir: {e}"))?;
    Ok(dir)
}

/// Copies an image file into the durable per-session assets directory and
/// returns the absolute persisted path. The source may be a temp file
/// (clipboard paste) or a workspace file.
#[tauri::command]
pub async fn persist_session_image(session_id: String, src_path: String) -> Result<String, String> {
    let src = PathBuf::from(&src_path);
    let (src, base_name) = tauri::async_runtime::spawn_blocking(move || {
        let canonical = src.canonicalize().map_err(|e| format!("source image not found: {e}"))?;
        if !canonical.is_file() {
            return Err(format!("source image is not a file: {}", canonical.display()));
        }
        let name = canonical
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "image.png".to_string());
        Ok::<_, String>((canonical, name))
    })
    .await
    .map_err(|e| format!("persist task failed: {e}"))??;

    let assets_dir = session_assets_dir(&session_id)?;
    // Namespace by timestamp+nonce so repeated pastes of the same filename
    // don't collide and aren't predictable/plantable.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let nonce: u64 = rand::random();
    let dest = unique_path(&assets_dir, &base_name, ts, nonce);

    tauri::async_runtime::spawn_blocking(move || {
        // Copy (not move) so the original temp/workspace file is untouched.
        std::fs::copy(&src, &dest)
            .map_err(|e| format!("failed to copy image into session assets: {e}"))?;
        Ok::<_, String>(dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("copy task failed: {e}"))?
}

/// Build a non-colliding destination path inside `dir`.
fn unique_path(dir: &Path, base_name: &str, ts: u128, nonce: u64) -> PathBuf {
    let stem = Path::new(base_name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| base_name.to_string());
    let ext = Path::new(base_name)
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    dir.join(format!("{stem}-{ts}-{nonce}{ext}"))
}

#[cfg(test)]
mod assets_tests {
    use super::*;

    #[test]
    fn session_assets_dir_is_under_hermes_home() {
        // hermes_home() reads HERMES_HOME; verify the constructed path nesting.
        let tmp = std::env::temp_dir().join(format!(
            "hermes-assets-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::env::set_var("HERMES_HOME", &tmp);
        let dir = session_assets_dir("sess-1").unwrap();
        std::env::remove_var("HERMES_HOME");
        assert!(dir.starts_with(&tmp));
        assert!(dir.ends_with("sessions/sess-1/assets"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
