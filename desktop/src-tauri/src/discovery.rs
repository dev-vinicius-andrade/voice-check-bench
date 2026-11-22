// Actuator discovery: filesystem-level detection of installed audio software.
// Returns DetectedActuator structs to the frontend so adapters can register without
// requiring Wave Link to be running (unlike the wavelink_read probe).
use serde::Serialize;
use std::path::PathBuf;

/// A detected audio actuator on the user's machine.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DetectedActuator {
    /// Matches ActuatorCapability.id in src/plain/actuator.ts (e.g. "reaplugs").
    pub id: String,
    /// Human-readable product name. Never translated.
    pub name: String,
    /// When this actuator was confirmed present (ISO 8601 UTC).
    pub detected_at: String,
    /// Optional metadata (install path, version).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<std::collections::HashMap<String, String>>,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Check for Wave Link + ReaPlugs by looking for Settings.json at the known install path.
/// This works even when Wave Link is not running — it just checks if the file exists.
fn detect_wavelink() -> Option<DetectedActuator> {
    // Respect the same override env var that wavelink/files.rs uses
    let settings_path = if let Some(p) = std::env::var_os("VCB_WAVELINK_SETTINGS").filter(|p| !p.is_empty()) {
        PathBuf::from(p)
    } else {
        match std::env::var_os("LOCALAPPDATA") {
            Some(base) => PathBuf::from(base)
                .join("Packages")
                .join("Elgato.WaveLink_g54w8ztgkx496")
                .join("LocalState")
                .join("Settings.json"),
            None => return None,
        }
    };

    if settings_path.exists() {
        let mut meta = std::collections::HashMap::new();
        meta.insert("settingsPath".to_string(), settings_path.display().to_string());
        Some(DetectedActuator {
            id: "reaplugs".to_string(),
            name: "Wave Link ReaPlugs".to_string(),
            detected_at: now_iso(),
            meta: Some(meta),
        })
    } else {
        None
    }
}

/// Check for Equalizer APO by reading its install path from the Windows registry
/// and verifying config.ini exists there. Works without Equalizer APO running.
#[cfg(target_os = "windows")]
fn detect_equalizer_apo() -> Option<DetectedActuator> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    // Equalizer APO writes its install path to HKLM\SOFTWARE\EqualizerAPO\InstallPath
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = match hklm.open_subkey_with_flags("SOFTWARE\\EqualizerAPO", KEY_READ) {
        Ok(k) => k,
        Err(_) => return None,
    };
    let install_path: String = match key.get_value("InstallPath") {
        Ok(p) => p,
        Err(_) => return None,
    };

    let config_path = PathBuf::from(&install_path).join("config.ini");
    if !config_path.exists() {
        return None;
    }

    let mut meta = std::collections::HashMap::new();
    meta.insert("installPath".to_string(), install_path.clone());
    meta.insert("configPath".to_string(), config_path.display().to_string());

    // Try to read version from registry (optional)
    if let Ok(version) = key.get_value::<String, _>("Version") {
        meta.insert("version".to_string(), version);
    }

    Some(DetectedActuator {
        id: "equalizer-apo".to_string(),
        name: "Equalizer APO".to_string(),
        detected_at: now_iso(),
        meta: Some(meta),
    })
}

#[cfg(not(target_os = "windows"))]
fn detect_equalizer_apo() -> Option<DetectedActuator> {
    None
}

/// Scan for all known audio actuators. Detects Wave Link + ReaPlugs and Equalizer APO;
/// future: OBS Studio (profiles dir).
#[tauri::command]
pub fn detect_actuators() -> Vec<DetectedActuator> {
    let mut found = Vec::new();
    if let Some(wl) = detect_wavelink() {
        found.push(wl);
    }
    if let Some(eq) = detect_equalizer_apo() {
        found.push(eq);
    }
    found
}