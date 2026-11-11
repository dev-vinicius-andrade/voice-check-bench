// Tauri commands of the audio engine. One engine at a time (process-wide); blocking work runs off the main thread.
use std::sync::{Mutex, MutexGuard};

use tauri::ipc::{Channel, InvokeResponseBody};

use super::devices::{self, AudioDevices};
use super::engine::{Engine, EngineOptions};
use super::error::{err, AudioError, AudioErrorCode, AudioResult};
use super::pipeline::Monitor;
use super::types::{AudioSlot, AudioStatus, ChainSource};
use super::DEFAULT_GAIN_DB;
use crate::chain::{ChainEntrySpec, ExportedState};
use crate::wavelink::files::read_text;
use crate::wavelink::{default_settings_path, list_inputs};

static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);

fn engine() -> MutexGuard<'static, Option<Engine>> {
    ENGINE.lock().unwrap_or_else(|p| p.into_inner())
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AudioResult<T> + Send + 'static,
) -> AudioResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or_else(|e| {
            Err(AudioError::new(
                AudioErrorCode::StreamFailed,
                format!("background task failed: {e}"),
            ))
        })
}

/// Run `f` on the running engine.
fn with_engine<T>(f: impl FnOnce(&Engine) -> AudioResult<T>) -> AudioResult<T> {
    match engine().as_ref() {
        Some(e) => f(e),
        None => err(
            AudioErrorCode::NotRunning,
            "the audio engine is not running",
        ),
    }
}

/// The mic input's chain (the first input `list_inputs` returns) from Wave Link Settings.json, read-only.
pub fn mic_chain() -> AudioResult<(ChainSource, Vec<ChainEntrySpec>)> {
    let path = default_settings_path()?;
    let text = read_text(&path)?;
    let Some(mic) = list_inputs(&text)?.into_iter().next() else {
        return err(AudioErrorCode::Settings, "Settings.json has no mic input");
    };
    let specs = mic
        .entries
        .iter()
        .map(|e| ChainEntrySpec {
            name: e.name.clone(),
            file_path: e.file_path.clone(),
            bypassed: e.bypassed,
            parameter_state: e.parameter_state.clone(),
        })
        .collect();
    let source = ChainSource {
        settings_path: path.display().to_string(),
        input_key: mic.key,
        input_label: mic.label,
    };
    Ok((source, specs))
}

/// Stop the engine if it runs (app exit).
pub fn shutdown() {
    if let Some(e) = engine().take() {
        e.stop();
    }
}

/// Capture and render devices, with the ones `audio_start` picks by default.
#[tauri::command]
pub async fn audio_devices() -> AudioResult<AudioDevices> {
    blocking(devices::list).await
}

/// Start the engine on the current Wave Link mic chain. `monitor` defaults to Off, `gainDb` to −10 dB. Every
/// 100 ms `onFrame` receives a binary frame (src/desktop/audioFrame.ts).
#[tauri::command]
pub async fn audio_start(
    input_id: Option<String>,
    output_id: Option<String>,
    monitor: Option<Monitor>,
    gain_db: Option<f32>,
    on_frame: Channel<InvokeResponseBody>,
) -> AudioResult<AudioStatus> {
    blocking(move || {
        let mut slot = engine();
        if slot.is_some() {
            return err(AudioErrorCode::AlreadyRunning, "stop the engine first");
        }
        let (source, specs) = mic_chain()?;
        let opts = EngineOptions {
            input_id,
            output_id,
            monitor: monitor.unwrap_or(Monitor::Off),
            gain_db: gain_db.unwrap_or(DEFAULT_GAIN_DB),
            source: Some(source),
        };
        let sink = Box::new(move |frame: super::StreamFrame| {
            // A closed webview only means nobody listens any more.
            let _ = on_frame.send(InvokeResponseBody::Raw(frame.encode()));
        });
        let e = Engine::start(&specs, &opts, sink)?;
        let status = e.status();
        *slot = Some(e);
        Ok(status)
    })
    .await
}

/// Stop the engine (no-op when it is not running).
#[tauri::command]
pub async fn audio_stop() -> AudioResult<()> {
    blocking(|| {
        shutdown();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn audio_set_param(slot: usize, id: u32, value: f64) -> AudioResult<AudioSlot> {
    blocking(move || with_engine(|e| e.set_param(slot, id, value))).await
}

#[tauri::command]
pub async fn audio_set_bypass(slot: usize, bypassed: bool) -> AudioResult<AudioSlot> {
    blocking(move || with_engine(|e| e.set_bypass(slot, bypassed))).await
}

#[tauri::command]
pub async fn audio_load_state(slot: usize, parameter_state: String) -> AudioResult<AudioSlot> {
    blocking(move || with_engine(|e| e.load_state(slot, &parameter_state))).await
}

#[tauri::command]
pub async fn audio_set_monitor(monitor: Monitor) -> AudioResult<()> {
    blocking(move || with_engine(|e| e.set_monitor(monitor))).await
}

#[tauri::command]
pub async fn audio_set_gain(gain_db: f32) -> AudioResult<()> {
    blocking(move || with_engine(|e| e.set_gain_db(gain_db))).await
}

/// Every hosted slot's current state of the running engine (blocking; see `audio_export_states`).
pub fn export_states() -> AudioResult<Vec<ExportedState>> {
    with_engine(Engine::export_states)
}

/// Every hosted slot's current `ParameterState` and `BypassState` (the plugin's own bypass follows the slot), in
/// chain order: what "Save to Wave Link" writes for effects changed live. Nothing is written here.
#[tauri::command]
pub async fn audio_export_states() -> AudioResult<Vec<ExportedState>> {
    blocking(export_states).await
}

/// The engine's status, or null when it is not running.
#[tauri::command]
pub async fn audio_status() -> AudioResult<Option<AudioStatus>> {
    blocking(|| Ok(engine().as_ref().map(Engine::status))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_states_needs_a_running_engine() {
        shutdown();
        let e = export_states().unwrap_err();
        assert_eq!(e.code, AudioErrorCode::NotRunning);
    }

    #[test]
    fn exported_state_serde_shape() {
        let v = serde_json::to_value(ExportedState {
            index: 2,
            name: "Elgato Noise Removal".into(),
            file_path: "C:/nr.vst3".into(),
            bypassed: true,
            parameter_state: "QQ==".into(),
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({"index":2,"name":"Elgato Noise Removal","filePath":"C:/nr.vst3","bypassed":true,"parameterState":"QQ=="})
        );
    }
}
