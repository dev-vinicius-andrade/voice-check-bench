use serde::Serialize;

pub mod audio;
pub mod chain;
pub mod host;
pub mod wavelink;

/// What the engine reports about itself; proves the JS ↔ Rust bridge (`src/desktop/types.ts` EngineInfo).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    app_version: String,
    rust_version: Option<&'static str>,
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
fn engine_info(app: tauri::AppHandle) -> EngineInfo {
    EngineInfo {
        app_version: app.package_info().version.to_string(),
        rust_version: option_env!("VCB_RUSTC_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Auto-update from the GitHub Releases feed (tauri.conf.json plugins.updater) and relaunch after install.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            engine_info,
            wavelink::commands::wavelink_read,
            wavelink::commands::wavelink_preview,
            wavelink::commands::wavelink_export,
            wavelink::commands::wavelink_backups,
            wavelink::commands::wavelink_restore,
            audio::commands::audio_devices,
            audio::commands::audio_start,
            audio::commands::audio_stop,
            audio::commands::audio_set_param,
            audio::commands::audio_set_bypass,
            audio::commands::audio_load_state,
            audio::commands::audio_set_monitor,
            audio::commands::audio_set_gain,
            audio::commands::audio_status,
            audio::commands::audio_export_states,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Voice Check Bench")
        .run(|_, event| {
            // Stop the audio streams and unload the plugins before the process goes away.
            if let tauri::RunEvent::Exit = event {
                audio::commands::shutdown();
            }
        })
}
