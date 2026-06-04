use std::path::PathBuf;

/// Returns the HERMES_HOME directory path.
/// Uses ~/.hermes as default, with optional HERMES_HOME env var override.
#[tauri::command]
pub fn get_hermes_home(_app: tauri::AppHandle) -> Result<String, String> {
    if let Ok(custom_home) = std::env::var("HERMES_HOME") {
        return Ok(custom_home);
    }
    let home_dir = std::env::var("HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from))
        .map_err(|_| "Failed to get home directory".to_string())?;
    Ok(home_dir.join(".hermes").to_string_lossy().to_string())
}

/// Reads a file relative to HERMES_HOME
#[tauri::command]
pub fn read_file(path: String, app: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
    let home = get_hermes_home(app)?;
    let full_path = PathBuf::from(&home).join(&path);

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
    use std::fs;
    let home = get_hermes_home(app.clone())?;
    let full_path = PathBuf::from(&home).join(&path);

    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    fs::write(full_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Lists directory contents relative to HERMES_HOME
#[tauri::command]
pub fn list_dir(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use std::fs;
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
