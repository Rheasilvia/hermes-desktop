use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Windows,
    MacOS,
    Linux,
}

/// Returns the desktop app version from Cargo.toml
#[tauri::command]
pub fn get_app_version(app: tauri::AppHandle) -> String {
    app.config()
        .version
        .clone()
        .unwrap_or_else(|| "0.1.0".to_string())
}

/// Returns the current platform
#[tauri::command]
pub fn get_platform() -> Platform {
    if cfg!(target_os = "windows") {
        Platform::Windows
    } else if cfg!(target_os = "macos") {
        Platform::MacOS
    } else {
        Platform::Linux
    }
}

/// Opens a URL in the default browser
#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))
}

/// Spawns a child process. Returns the process ID.
/// NOTE: Not registered as a Tauri command — not callable from the frontend.
pub async fn spawn_process(cmd: String, args: Vec<String>) -> Result<u32, String> {
    use std::process::Command;
    let child = Command::new(&cmd)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;
    Ok(child.id())
}

/// Reveals a file or folder in the native file manager.
/// Canonicalizes the path first to reject crafted or nonexistent paths.
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    use std::process::Command;

    // Verify the path exists and resolve symlinks / `..` components.
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Path not found or inaccessible: {}", e))?;
    let canonical_str = canonical.to_string_lossy();

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", canonical_str.as_ref()])
            .spawn()
            .map_err(|e| format!("reveal failed: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args([format!("/select,{}", canonical_str)])
            .spawn()
            .map_err(|e| format!("reveal failed: {}", e))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let parent = canonical
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| canonical_str.to_string());
        Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| format!("reveal failed: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn reveal_workspace_path(root: String, path: String) -> Result<(), String> {
    use std::process::Command;

    let canonical_root = std::path::PathBuf::from(&root)
        .canonicalize()
        .map_err(|e| format!("workspace root not found: {}", e))?;

    // Resolve path — if relative, join under root first
    let raw = std::path::PathBuf::from(&path);
    let absolute = if raw.is_absolute() { raw } else { canonical_root.join(raw) };
    let canonical = absolute
        .canonicalize()
        .map_err(|e| format!("path not found: {}", e))?;

    if !canonical.starts_with(&canonical_root) {
        return Err("path escapes workspace root".to_string());
    }

    let canonical_str = canonical.to_string_lossy();

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", canonical_str.as_ref()])
            .spawn()
            .map_err(|e| format!("reveal failed: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args([format!("/select,{}", canonical_str)])
            .spawn()
            .map_err(|e| format!("reveal failed: {}", e))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let parent = canonical
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| canonical_str.to_string());
        Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| format!("reveal failed: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod platform_tests {
    use super::*;

    #[test]
    fn reveal_workspace_path_rejects_path_outside_root() {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("hermes_reveal_root_{suffix}"));
        let outside = std::env::temp_dir().join(format!("hermes_reveal_outside_{suffix}"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();

        let result = reveal_workspace_path(
            root.to_string_lossy().to_string(),
            outside.to_string_lossy().to_string(),
        );
        assert!(result.is_err(), "reveal_workspace_path must reject paths outside workspace root");
        assert!(result.unwrap_err().contains("escapes workspace root"));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn reveal_workspace_path_accepts_path_inside_root() {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("hermes_reveal_inside_{suffix}"));
        let inside = root.join("subdir");
        fs::create_dir_all(&inside).unwrap();

        // reveal_workspace_path spawns `open -R` on macOS — only test the containment
        // logic, not the actual spawn (which would open Finder in a test run).
        // We verify the function at least reaches the spawn step (no Err on containment).
        // The spawn itself may fail in a headless CI environment, which is acceptable.
        let result = reveal_workspace_path(
            root.to_string_lossy().to_string(),
            inside.to_string_lossy().to_string(),
        );
        // Accept Ok (Finder opened) or Err from spawn failure in headless env —
        // only fail if the error is about workspace containment.
        if let Err(ref e) = result {
            assert!(
                !e.contains("escapes workspace root"),
                "reveal_workspace_path must not reject paths inside workspace root; got: {e}"
            );
        }

        let _ = fs::remove_dir_all(root);
    }
}
