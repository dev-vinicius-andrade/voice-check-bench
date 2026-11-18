// Tauri commands of the offline render session. One session at a time (process-wide), independent of the live
// engine; every command runs off the main thread. Samples cross the IPC as raw little-endian f32 bytes.
use std::sync::{Mutex, MutexGuard};

use tauri::ipc::{InvokeBody, Request, Response};

use super::{RenderSession, RenderStatus};
use crate::audio::commands::{blocking, mic_chain};
use crate::audio::error::{err, AudioErrorCode, AudioResult};
use crate::audio::AudioSlot;
use crate::chain::ExportedState;

static SESSION: Mutex<Option<RenderSession>> = Mutex::new(None);

fn session() -> MutexGuard<'static, Option<RenderSession>> {
    SESSION.lock().unwrap_or_else(|p| p.into_inner())
}

/// Run `f` on the open session (held for the whole call, so settings never change during a run).
fn with_session<T>(f: impl FnOnce(&mut RenderSession) -> AudioResult<T>) -> AudioResult<T> {
    match session().as_mut() {
        Some(s) => f(s),
        None => err(
            AudioErrorCode::NotRunning,
            "no render session is open (render_open first)",
        ),
    }
}

/// Unload the session's plugins if one is open (render_close, app exit).
pub fn close() {
    let mut s = session();
    *s = None;
}

/// Raw IPC body → samples: little-endian f32, a whole number of samples.
pub fn samples_from_le_bytes(bytes: &[u8]) -> AudioResult<Vec<f32>> {
    let (samples, rest) = bytes.as_chunks::<4>();
    if !rest.is_empty() {
        return err(
            AudioErrorCode::InvalidArgument,
            format!("{} bytes is not a whole number of f32 samples", bytes.len()),
        );
    }
    Ok(samples.iter().map(|b| f32::from_le_bytes(*b)).collect())
}

/// Samples → raw IPC response body (little-endian f32).
pub fn samples_to_le_bytes(samples: &[f32]) -> Vec<u8> {
    samples.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// Open a render session on the current Wave Link mic chain (Settings.json is only read). Replaces an open one:
/// the old plugins unload before the new ones load. May run while the live engine runs (its own plugin instances).
#[tauri::command]
pub async fn render_open() -> AudioResult<RenderStatus> {
    blocking(|| {
        let (_source, specs) = mic_chain()?;
        let mut slot = session();
        *slot = None;
        let s = RenderSession::open(&specs)?;
        let status = s.status();
        *slot = Some(s);
        Ok(status)
    })
    .await
}

#[tauri::command]
pub async fn render_set_param(slot: usize, id: u32, value: f64) -> AudioResult<AudioSlot> {
    blocking(move || with_session(|s| s.set_param(slot, id, value))).await
}

#[tauri::command]
pub async fn render_set_bypass(slot: usize, bypassed: bool) -> AudioResult<AudioSlot> {
    blocking(move || with_session(|s| s.set_bypass(slot, bypassed))).await
}

#[tauri::command]
pub async fn render_load_state(slot: usize, parameter_state: String) -> AudioResult<AudioSlot> {
    blocking(move || with_session(|s| s.load_state(slot, &parameter_state))).await
}

/// Render the raw body (mono little-endian f32 at 48 kHz) through the session's chain. The response is the processed
/// take as little-endian f32: same length, aligned to the input (chain latency removed), repeatable.
#[tauri::command]
pub async fn render_run(request: Request<'_>) -> AudioResult<Response> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return err(
            AudioErrorCode::InvalidArgument,
            "render_run takes the samples as a raw little-endian f32 body",
        );
    };
    let bytes = bytes.clone();
    let out = blocking(move || {
        let input = samples_from_le_bytes(&bytes)?;
        with_session(|s| s.run(&input))
    })
    .await?;
    Ok(Response::new(samples_to_le_bytes(&out)))
}

/// Every hosted slot's current state of the session's chain (same shape as `audio_export_states`).
#[tauri::command]
pub async fn render_export_states() -> AudioResult<Vec<ExportedState>> {
    blocking(|| with_session(|s| s.export_states())).await
}

/// Close the session and unload its plugins (no-op when none is open).
#[tauri::command]
pub async fn render_close() -> AudioResult<()> {
    blocking(|| {
        close();
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_round_trip_as_little_endian_bytes() {
        let s = [0.0f32, -1.0, 1.0, 0.25, -0.123_456_79, f32::MIN_POSITIVE];
        let bytes = samples_to_le_bytes(&s);
        assert_eq!(bytes.len(), 4 * s.len());
        assert_eq!(
            &bytes[4..8],
            &[0x00, 0x00, 0x80, 0xbf],
            "-1.0 little-endian"
        );
        assert_eq!(samples_from_le_bytes(&bytes).unwrap(), s);
        assert!(samples_from_le_bytes(&[]).unwrap().is_empty());
        let e = samples_from_le_bytes(&bytes[..7]).unwrap_err();
        assert_eq!(e.code, AudioErrorCode::InvalidArgument);
    }

    #[test]
    fn commands_need_an_open_session() {
        close();
        let e = with_session(|s| s.export_states()).unwrap_err();
        assert_eq!(e.code, AudioErrorCode::NotRunning);
        let e = with_session(|s| s.run(&[0.0])).unwrap_err();
        assert_eq!(e.code, AudioErrorCode::NotRunning);
    }
}
