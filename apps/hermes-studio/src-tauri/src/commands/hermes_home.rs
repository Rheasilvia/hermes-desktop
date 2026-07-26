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

/// Writes a file relative to HERMES_HOME, rejecting any path that escapes the home boundary.
#[tauri::command]
pub fn write_file(path: String, content: String, app: tauri::AppHandle) -> Result<(), String> {
    use std::fs;
    let home = get_hermes_home(app.clone())?;
    let final_path = resolve_under_hermes_home(&home, &path)?;
    fs::write(final_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Lists directory contents relative to HERMES_HOME, rejecting any path that escapes the home boundary.
#[tauri::command]
pub fn list_dir(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use std::fs;
    let home = get_hermes_home(app)?;
    let canonical_path = resolve_existing_under_hermes_home(&home, &path)?;

    let entries =
        fs::read_dir(canonical_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    result.sort();
    Ok(result)
}

/// Resolves `rel_path` under `home`, creating parent directories as needed.
/// Returns the final absolute path, or an error if the path escapes `home`.
/// Used by `write_file` and unit tests.
fn resolve_under_hermes_home(home: &str, rel_path: &str) -> Result<PathBuf, String> {
    let canonical_home = std::fs::canonicalize(home)
        .or_else(|_| std::fs::create_dir_all(home).and_then(|_| std::fs::canonicalize(home)))
        .map_err(|e| format!("Invalid home path: {}", e))?;

    let full_path = PathBuf::from(home).join(rel_path);
    let parent = full_path
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;

    std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;

    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("Failed to resolve parent: {}", e))?;

    if !canonical_parent.starts_with(&canonical_home) {
        return Err("Path escapes HERMES_HOME".to_string());
    }

    let filename = full_path
        .file_name()
        .ok_or_else(|| "path has no filename".to_string())?;

    Ok(canonical_parent.join(filename))
}

/// Resolves `rel_path` under `home` for an already-existing directory.
/// Returns the canonicalized path, or an error if the directory doesn't exist or escapes `home`.
/// Used by `list_dir` and unit tests.
fn resolve_existing_under_hermes_home(home: &str, rel_path: &str) -> Result<PathBuf, String> {
    let canonical_home = std::fs::canonicalize(home)
        .or_else(|_| std::fs::create_dir_all(home).and_then(|_| std::fs::canonicalize(home)))
        .map_err(|e| format!("Invalid home path: {}", e))?;

    let full_path = PathBuf::from(home).join(rel_path);
    let canonical_path = std::fs::canonicalize(&full_path)
        .map_err(|e| format!("Directory not found: {}", e))?;

    if !canonical_path.starts_with(&canonical_home) {
        return Err("Path escapes HERMES_HOME".to_string());
    }

    Ok(canonical_path)
}

#[cfg(test)]
mod hermes_home_tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_hermes_home(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("hermes_home_test_{name}_{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn test_resolve_under_hermes_home_traversal_rejected() {
        let home = temp_hermes_home("write_escape");
        let err =
            resolve_under_hermes_home(home.to_str().unwrap(), "../../etc/passwd").unwrap_err();
        assert!(
            err.contains("escapes HERMES_HOME"),
            "unexpected error: {err}"
        );
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn test_resolve_under_hermes_home_absolute_outside_rejected() {
        let home = temp_hermes_home("write_abs");
        // An absolute path that points outside home should be rejected.
        // join() with an absolute path replaces the base on most platforms.
        // On Unix this means PathBuf::from(home).join("/tmp/evil") == /tmp/evil.
        let err =
            resolve_under_hermes_home(home.to_str().unwrap(), "/tmp/evil_file.txt").unwrap_err();
        // Could be "escapes HERMES_HOME" or a directory-creation error for "/tmp" parent.
        // Either means the write was blocked from writing outside home.
        assert!(
            err.contains("escapes HERMES_HOME") || err.contains("Failed to create directory"),
            "unexpected error: {err}"
        );
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn test_list_dir_escape_rejected() {
        let home = temp_hermes_home("list_escape");
        // Create a real sibling directory so canonicalize would succeed if the
        // escape check were absent.
        let sibling = std::env::temp_dir().join(format!(
            "hermes_sibling_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&sibling).unwrap();

        // Construct a traversal that would land in the sibling directory.
        let home_str = home.to_str().unwrap();
        let sibling_name = sibling.file_name().unwrap().to_str().unwrap();
        let traversal = format!("../{}", sibling_name);

        let err =
            resolve_existing_under_hermes_home(home_str, &traversal).unwrap_err();
        assert!(
            err.contains("escapes HERMES_HOME"),
            "unexpected error: {err}"
        );

        let _ = fs::remove_dir_all(&home);
        let _ = fs::remove_dir_all(&sibling);
    }
}
