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

#[cfg(test)]
mod platform_tests {
    use super::*;

    /// V2 red test: reveal_in_finder accepts any canonical path with no workspace root check.
    ///
    /// V1 bug: reveal_in_finder(path) accepts any path that exists on the filesystem,
    /// with no workspace containment check. The V2 requirement is that a new command
    /// reveal_workspace_path(root, path) verifies the path is contained within root.
    ///
    /// This test calls reveal_in_finder with an existing outside path and asserts it
    /// returns Err. On V1 it will succeed (returning Ok), making the test fail (red).
    ///
    /// Once Task 3 adds reveal_workspace_path(root, path) with containment enforcement,
    /// this test should be updated to call reveal_workspace_path instead.
    #[test]
    fn reveal_in_finder_rejects_path_outside_workspace() {
        use std::fs;

        let root = std::env::temp_dir().join("hermes_reveal_root_test");
        fs::create_dir_all(&root).unwrap();
        let outside = std::env::temp_dir().join("hermes_reveal_outside_test");
        fs::create_dir_all(&outside).unwrap();

        // V1: reveal_in_finder has no root parameter and no containment check.
        // It succeeds for any existing path, so this assertion fails on V1 (red test).
        // V2: rename to reveal_workspace_path(root, path) and add containment check.
        // Until Task 3 is done, we verify V1 does NOT enforce the boundary by calling
        // reveal_in_finder directly and asserting it should fail but will succeed.
        //
        // Strategy: assert that a path-only reveal with an outside path is rejected.
        // On V1 this is Ok(()), so the assert fires — that's the intended red state.
        let result = reveal_in_finder(outside.to_string_lossy().to_string());

        // On V1 this assertion FAILS because reveal_in_finder returns Ok(())
        // (no workspace boundary check). This is the expected red test behaviour.
        assert!(
            result.is_err(),
            "reveal_in_finder must reject paths outside any workspace root; \
             V1 bug: no root parameter, no containment check — got Ok(())"
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }
}
