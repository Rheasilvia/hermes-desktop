mod commands;
mod updater;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            updater::check_for_updates,
            updater::install_update,
        ])
        .setup(|app| {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
