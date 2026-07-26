use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Check for available updates via the Tauri updater plugin.
/// Returns update info if an update is available, None otherwise.
#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = app
        .updater()
        .map_err(|e| format!("Updater not available: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let notes = update.body.clone();
            let date = update.date.map(|d| d.to_string());
            tracing::info!("Update available: {}", version);
            Ok(Some(UpdateInfo {
                version,
                notes,
                date,
            }))
        }
        Ok(None) => {
            tracing::info!("No updates available");
            Ok(None)
        }
        Err(e) => {
            tracing::error!("Failed to check for updates: {}", e);
            Err(format!("Failed to check for updates: {}", e))
        }
    }
}

/// Download and install the available update.
/// Returns an error string if no update is available or installation fails.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = app
        .updater()
        .map_err(|e| format!("Updater not available: {}", e))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {}", e))?
        .ok_or_else(|| "No update available to install".to_string())?;

    tracing::info!("Downloading and installing update: {}", update.version);

    update
        .download_and_install(
            |chunk_length, content_length| {
                tracing::debug!(
                    "Downloaded {} bytes (total: {:?})",
                    chunk_length,
                    content_length
                );
            },
            || {
                tracing::info!("Download finished, installing...");
            },
        )
        .await
        .map_err(|e| format!("Failed to install update: {}", e))?;

    Ok(())
}
