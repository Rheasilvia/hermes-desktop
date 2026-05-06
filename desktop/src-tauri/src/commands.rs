use serde::Serialize;
use std::fs;
use std::path::PathBuf;

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

/// Returns the HERMES_HOME directory path
/// Uses ~/.hermes as default, consistent with the Python backend,
/// with option to override via HERMES_HOME env var.
#[tauri::command]
pub fn get_hermes_home(_app: tauri::AppHandle) -> Result<String, String> {
    // Check for HERMES_HOME env var first (for connecting to existing hermes installations)
    if let Ok(custom_home) = std::env::var("HERMES_HOME") {
        return Ok(custom_home);
    }
    // Default: use ~/.hermes (consistent with Python backend)
    let home_dir = std::env::var("HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from))
        .map_err(|_| "Failed to get home directory".to_string())?;
    let hermes_home = home_dir.join(".hermes");
    Ok(hermes_home.to_string_lossy().to_string())
}

/// Reads a file relative to HERMES_HOME
#[tauri::command]
pub fn read_file(path: String, app: tauri::AppHandle) -> Result<String, String> {
    let home = get_hermes_home(app)?;
    let full_path = PathBuf::from(&home).join(&path);

    // Security: ensure path doesn't escape HERMES_HOME
    let canonical_home = std::fs::canonicalize(&home)
        .or_else(|_| std::fs::create_dir_all(&home).and_then(|_| std::fs::canonicalize(&home)))
        .map_err(|e| format!("Invalid home path: {}", e))?;
    let canonical_path = full_path
        .canonicalize()
        .map_err(|e| format!("Invalid file path: {}", e))?;

    if !canonical_path.starts_with(&canonical_home) {
        return Err("Path escapes HERMES_HOME".to_string());
    }

    fs::read_to_string(canonical_path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Writes a file relative to HERMES_HOME
#[tauri::command]
pub fn write_file(path: String, content: String, app: tauri::AppHandle) -> Result<(), String> {
    let home = get_hermes_home(app.clone())?;
    let full_path = PathBuf::from(&home).join(&path);

    // Create parent directories if needed
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    fs::write(full_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Lists directory contents relative to HERMES_HOME
#[tauri::command]
pub fn list_dir(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let home = get_hermes_home(app)?;
    let full_path = PathBuf::from(&home).join(&path);

    let entries =
        fs::read_dir(full_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    result.sort();
    Ok(result)
}

/// Opens a URL in the default browser
#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))
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

/// Spawns a child process (for future gateway connection)
/// Returns the process ID
#[tauri::command]
pub async fn spawn_process(cmd: String, args: Vec<String>) -> Result<u32, String> {
    use std::process::Command;

    let child = Command::new(&cmd)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;

    Ok(child.id())
}
