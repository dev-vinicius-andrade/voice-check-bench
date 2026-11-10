use serde::Serialize;

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
        .invoke_handler(tauri::generate_handler![engine_info])
        .run(tauri::generate_context!())
        .expect("error while running Voice Check Bench")
}
