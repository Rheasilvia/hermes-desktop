pub mod commands;
mod sidecar;
mod updater;

use serde::Deserialize;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// Horizontal position (logical px) of the macOS traffic-light cluster when the
/// title bar is in `Overlay` mode. The frontend action group starts at 85px, so
/// the native cluster must remain comfortably to its left.
#[cfg(target_os = "macos")]
const MACOS_TRAFFIC_LIGHT_X: f64 = 13.0;
/// Vertical position (logical px) of the macOS traffic-light cluster, aligned to
/// the vertical center of the 32px title bar (`--titlebar-height`).
#[cfg(target_os = "macos")]
const MACOS_TRAFFIC_LIGHT_Y: f64 = 18.0;

#[cfg(test)]
const REGISTERED_TAURI_COMMANDS: &[&str] = &[
    "get_app_version",
    "get_hermes_home",
    "read_file",
    "write_file",
    "list_dir",
    "open_external",
    "get_platform",
    "read_clipboard_image",
    "write_clipboard_image_from_url",
    "persist_session_image",
    "select_workspace_for_session",
    "sidecar_info",
    "check_for_updates",
    "install_update",
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
async fn sidecar_info() -> Result<sidecar::SidecarInfo, String> {
    sidecar::current_info()
        .await
        .ok_or_else(|| "sidecar not ready".into())
}

#[derive(Deserialize)]
struct SessionWorkspaceResponse {
    cwd: Option<String>,
}

fn session_update_url(base_url: &str, session_id: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(base_url)
        .map_err(|e| format!("invalid sidecar URL: {e}"))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "invalid sidecar URL path".to_string())?;
        segments.clear();
        segments.push("desktop");
        segments.push("api");
        segments.push("sessions");
        segments.push(session_id);
    }
    Ok(url)
}

#[tauri::command]
async fn select_workspace_for_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<String, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Select Workspace")
        .blocking_pick_folder()
        .ok_or_else(|| "WORKSPACE_SELECTION_CANCELLED".to_string())?;
    let selected_path = selected
        .into_path()
        .map_err(|e| format!("invalid workspace path: {e}"))?
        .canonicalize()
        .map_err(|e| format!("workspace not found: {e}"))?;
    if !selected_path.is_dir() {
        return Err("workspace path is not a directory".into());
    }

    let info = sidecar::current_info()
        .await
        .ok_or_else(|| "sidecar not ready".to_string())?;
    let grant = sidecar::current_workspace_grant_token()
        .await
        .ok_or_else(|| "workspace grant unavailable".to_string())?;
    let url = session_update_url(&info.base_url, &session_id)?;
    let resp = reqwest::Client::new()
        .patch(url)
        .bearer_auth(info.token)
        .header("X-Desktop-Workspace-Grant", grant)
        .json(&serde_json::json!({ "cwd": selected_path.to_string_lossy() }))
        .send()
        .await
        .map_err(|e| format!("workspace update failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("workspace update failed: {status}: {body}"));
    }
    let body: SessionWorkspaceResponse = resp
        .json()
        .await
        .map_err(|e| format!("workspace update response invalid: {e}"))?;
    body.cwd.ok_or_else(|| "workspace update response missing cwd".into())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            commands::platform::get_app_version,
            commands::hermes_home::get_hermes_home,
            commands::hermes_home::read_file,
            commands::hermes_home::write_file,
            commands::hermes_home::list_dir,
            commands::platform::open_external,
            commands::platform::get_platform,
            commands::clipboard::read_clipboard_image,
            commands::clipboard::write_clipboard_image_from_url,
            commands::assets::persist_session_image,
            select_workspace_for_session,
            sidecar_info,
            updater::check_for_updates,
            updater::install_update,
        ])
        .setup(|app| {
            // Spawn the daemon Python sidecar in the background
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match sidecar::spawn(handle.clone()).await {
                    Ok(info) => {
                        let _ = handle.emit("sidecar://ready", info);
                        let h2 = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            sidecar::run_health_probe(h2).await;
                        });
                    }
                    Err(e) => {
                        eprintln!("sidecar failed to start: {e:?}");
                        let _ = handle.emit("sidecar://failed", format!("{e}"));
                    }
                }
            });

            // Create main window programmatically (matching OpenCode pattern).
            // decorations:false (from tauri.conf.json) gives a frameless window on
            // every platform. On macOS we additionally switch to an Overlay title
            // bar so the native traffic-light buttons are preserved and positioned
            // to align with the custom frontend title bar — matching the Electron
            // app's `titleBarStyle: 'hidden'` + `trafficLightPosition` behavior.
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            let webview_url = tauri::WebviewUrl::App("index.html".into());
            let mut builder = tauri::WebviewWindowBuilder::new(app, "main", webview_url)
                .title("Hermes")
                .inner_size(1200.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .icon(icon)?;

            #[cfg(target_os = "macos")]
            {
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .traffic_light_position(tauri::LogicalPosition::new(
                        MACOS_TRAFFIC_LIGHT_X,
                        MACOS_TRAFFIC_LIGHT_Y,
                    ));
            }

            let _webview = builder.build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            tauri::async_runtime::block_on(async {
                if let Some(mut child) = sidecar::take_child().await {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                }
            });
        }
    });
}

#[cfg(test)]
mod command_surface_tests {
    use super::*;

    #[test]
    fn session_update_url_encodes_renderer_session_id_as_path_segment() {
        let url = session_update_url("http://127.0.0.1:18080", "desktop_abc/../../config")
            .expect("session url should build");

        assert_eq!(
            url.as_str(),
            "http://127.0.0.1:18080/desktop/api/sessions/desktop_abc%2F..%2F..%2Fconfig"
        );
    }

    #[test]
    fn unsafe_workspace_and_git_invokes_are_not_registered() {
        assert!(!REGISTERED_TAURI_COMMANDS.contains(&"get_workspace_root"));
        assert!(!REGISTERED_TAURI_COMMANDS.contains(&"list_workspace_children"));
        assert!(!REGISTERED_TAURI_COMMANDS.contains(&"read_workspace_file"));
        assert!(!REGISTERED_TAURI_COMMANDS.contains(&"reveal_workspace_path"));
        assert!(!REGISTERED_TAURI_COMMANDS.contains(&"run_git_diff"));
        assert!(!REGISTERED_TAURI_COMMANDS.contains(&"get_git_branches"));
        assert!(!REGISTERED_TAURI_COMMANDS.contains(&"checkout_git_branch"));
    }
}
