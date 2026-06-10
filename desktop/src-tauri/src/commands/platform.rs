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

fn resolve_reveal_workspace_path(root: &str, path: &str) -> Result<std::path::PathBuf, String> {
    let canonical_root = std::path::PathBuf::from(root)
        .canonicalize()
        .map_err(|e| format!("workspace root not found: {}", e))?;

    let raw = std::path::PathBuf::from(path);
    let absolute = if raw.is_absolute() { raw } else { canonical_root.join(raw) };
    let canonical = absolute
        .canonicalize()
        .map_err(|e| format!("path not found: {}", e))?;

    if !canonical.starts_with(&canonical_root) {
        return Err("path escapes workspace root".to_string());
    }

    Ok(canonical)
}

#[tauri::command]
pub fn reveal_workspace_path(root: String, path: String) -> Result<(), String> {
    use std::process::Command;

    let canonical = resolve_reveal_workspace_path(&root, &path)?;

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
    fn resolve_reveal_workspace_path_rejects_path_outside_root() {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("hermes_reveal_root_pure_{suffix}"));
        let outside = std::env::temp_dir().join(format!("hermes_reveal_outside_pure_{suffix}"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();

        let result = resolve_reveal_workspace_path(
            root.to_string_lossy().as_ref(),
            outside.to_string_lossy().as_ref(),
        );
        assert!(result.is_err(), "resolver must reject paths outside workspace root");
        assert!(result.unwrap_err().contains("escapes workspace root"));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn resolve_reveal_workspace_path_accepts_path_inside_root_without_spawning() {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("hermes_reveal_inside_{suffix}"));
        let inside = root.join("subdir");
        fs::create_dir_all(&inside).unwrap();

        let resolved = resolve_reveal_workspace_path(
            root.to_string_lossy().as_ref(),
            "subdir",
        )
        .expect("resolver must accept paths inside workspace root");

        assert_eq!(resolved, inside.canonicalize().unwrap());

        let _ = fs::remove_dir_all(root);
    }
}
