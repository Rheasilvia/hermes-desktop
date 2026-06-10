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
