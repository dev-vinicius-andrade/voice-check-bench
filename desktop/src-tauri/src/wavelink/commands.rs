// Tauri commands of the Wave Link module. Blocking work runs off the main thread; export and restore are
// serialized so two writes never overlap.
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Local;

use super::edit::{apply, diff, ChainChange, DiffLine};
use super::error::{WlError, WlErrorCode, WlResult};
use super::export::{export, restore, FlowReport, Options, Timings};
use super::files::{default_settings_path, list_backups, read_text, BackupInfo};
use super::model::{hash_text, list_inputs, WlSnapshot};
use super::process::WaveLinkProcess;

static WRITE_LOCK: Mutex<()> = Mutex::new(());

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> WlResult<T> + Send + 'static,
) -> WlResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or_else(|e| {
            Err(WlError::new(
                WlErrorCode::WriteFailed,
                format!("background task failed: {e}"),
            ))
        })
}

fn options(force: bool) -> Options {
    Options {
        force,
        timings: Timings::default(),
        now: Local::now().naive_local(),
    }
}

/// Settings.json path, hash and the inputs with their effect chains (read-only).
#[tauri::command]
pub async fn wavelink_read() -> WlResult<WlSnapshot> {
    blocking(|| {
        let path = default_settings_path()?;
        let text = read_text(&path)?;
        Ok(WlSnapshot {
            path: path.display().to_string(),
            hash: hash_text(&text),
            inputs: list_inputs(&text)?,
        })
    })
    .await
}

/// What `changes` would change in the current file. Nothing is written.
#[tauri::command]
pub async fn wavelink_preview(changes: Vec<ChainChange>) -> WlResult<Vec<DiffLine>> {
    blocking(move || {
        let text = read_text(&default_settings_path()?)?;
        diff(&text, &apply(&text, &changes)?)
    })
    .await
}

/// Backup, close Wave Link, write, start it again, verify. `expected_hash` is the hash from `wavelink_read`.
#[tauri::command]
pub async fn wavelink_export(
    changes: Vec<ChainChange>,
    expected_hash: String,
    force: bool,
) -> WlResult<FlowReport> {
    blocking(move || {
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        export(
            &default_settings_path()?,
            &WaveLinkProcess,
            &changes,
            &expected_hash,
            &options(force),
        )
    })
    .await
}

/// `Settings.before-*.json` next to Settings.json, newest first.
#[tauri::command]
pub async fn wavelink_backups() -> WlResult<Vec<BackupInfo>> {
    blocking(|| list_backups(&default_settings_path()?)).await
}

/// Writes a backup (from `wavelink_backups`) back over Settings.json, with the export's close/start/verify steps.
#[tauri::command]
pub async fn wavelink_restore(path: String, force: bool) -> WlResult<FlowReport> {
    blocking(move || {
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        restore(
            &default_settings_path()?,
            &WaveLinkProcess,
            &PathBuf::from(path),
            &options(force),
        )
    })
    .await
}
