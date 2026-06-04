pub mod commands;
mod sidecar;
mod updater;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
async fn sidecar_info() -> Result<sidecar::SidecarInfo, String> {
    sidecar::current_info()
        .await
        .ok_or_else(|| "sidecar not ready".into())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            commands::get_app_version,
            commands::get_hermes_home,
            commands::read_file,
            commands::write_file,
            commands::list_dir,
            commands::open_external,
            commands::get_platform,
            commands::spawn_process,
            commands::get_workspace_root,
            commands::list_workspace_children,
            commands::run_git_diff,
            commands::get_git_branches,
            commands::checkout_git_branch,
            commands::read_workspace_file,
            commands::reveal_in_finder,
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

            // Create main window programmatically (matching OpenCode pattern)
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            let webview_url = tauri::WebviewUrl::App("index.html".into());
            let _webview = tauri::WebviewWindowBuilder::new(app, "main", webview_url)
                .title("Hermes")
                .inner_size(1200.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .icon(icon)?
                .build()?;
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
