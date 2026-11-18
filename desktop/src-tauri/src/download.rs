// "Download" of the recording screen's Before / After (SPEC "Tune from a recording — screen"): the webview hands over
// a finished WAV file as the raw body and its name in the `x-file-name` header (a blob download does not reach the
// disk in the Tauri webview). It is written to the user's Downloads folder, never over an existing file.
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::Manager;

pub const NAME_HEADER: &str = "x-file-name";
const MAX_NAME: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadErrorCode {
    /// The name is not a plain `<name>.wav` file name.
    InvalidName,
    /// The body is not a WAV file.
    NotWav,
    /// The Downloads folder could not be found.
    NoFolder,
    WriteFailed,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadError {
    pub code: DownloadErrorCode,
    pub message: String,
}

fn fail<T>(code: DownloadErrorCode, message: impl Into<String>) -> Result<T, DownloadError> {
    Err(DownloadError {
        code,
        message: message.into(),
    })
}

/// `name` when it is a plain file name ending in `.wav` (letters, digits, `-`, `_`, `.`; no folders, no `..`).
pub fn safe_name(name: &str) -> Result<&str, DownloadError> {
    let ok = name.len() <= MAX_NAME
        && name.len() > ".wav".len()
        && name.to_ascii_lowercase().ends_with(".wav")
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok {
        Ok(name)
    } else {
        fail(
            DownloadErrorCode::InvalidName,
            format!("{name:?} is not a plain .wav file name"),
        )
    }
}

/// A RIFF/WAVE file with at least a header.
pub fn is_wav(bytes: &[u8]) -> bool {
    bytes.len() >= 44 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE"
}

/// Writes `bytes` as a NEW file `name` in `dir`; an existing name gets `-2`, `-3`… before `.wav`.
pub fn write_new(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, DownloadError> {
    let stem = &name[..name.len() - ".wav".len()];
    let ext = &name[name.len() - ".wav".len()..];
    for n in 1..100 {
        let path = dir.join(if n == 1 {
            name.to_string()
        } else {
            format!("{stem}-{n}{ext}")
        });
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                return match f.write_all(bytes).and_then(|()| f.sync_all()) {
                    Ok(()) => Ok(path),
                    Err(e) => {
                        drop(f);
                        let _ = fs::remove_file(&path);
                        fail(
                            DownloadErrorCode::WriteFailed,
                            format!("cannot write {}: {e}", path.display()),
                        )
                    }
                };
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return fail(
                    DownloadErrorCode::WriteFailed,
                    format!("cannot create {}: {e}", path.display()),
                )
            }
        }
    }
    fail(
        DownloadErrorCode::WriteFailed,
        format!("too many files named like {name}"),
    )
}

/// Saves the raw body (a WAV file) as `x-file-name` in the Downloads folder; returns the full path written.
#[tauri::command]
pub async fn save_wav(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<String, DownloadError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return fail(
            DownloadErrorCode::NotWav,
            "save_wav takes the WAV file as a raw body",
        );
    };
    if !is_wav(bytes) {
        return fail(DownloadErrorCode::NotWav, "the body is not a WAV file");
    }
    let header = request.headers().get(NAME_HEADER);
    let name = safe_name(header.and_then(|v| v.to_str().ok()).unwrap_or(""))?.to_string();
    let Ok(dir) = app.path().download_dir() else {
        return fail(
            DownloadErrorCode::NoFolder,
            "the Downloads folder was not found",
        );
    };
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || write_new(&dir, &name, &bytes))
        .await
        .unwrap_or_else(|e| {
            fail(
                DownloadErrorCode::WriteFailed,
                format!("background task failed: {e}"),
            )
        })
        .map(|p| p.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(n: usize) -> Vec<u8> {
        let mut b = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        b.resize(44 + n, 0);
        b
    }

    #[test]
    fn names_are_plain_wav_file_names() {
        assert!(safe_name("voice-check-before-2026-11-18-0312.wav").is_ok());
        assert!(safe_name("take_2.WAV").is_ok());
        for bad in [
            "",
            ".wav",
            "x.txt",
            "../x.wav",
            "a/b.wav",
            "a\\b.wav",
            "C:x.wav",
            "-x.wav",
            "a..wav",
            "ação.wav",
            &format!("{}.wav", "a".repeat(100)),
        ] {
            assert_eq!(
                safe_name(bad).unwrap_err().code,
                DownloadErrorCode::InvalidName,
                "{bad}"
            );
        }
    }

    #[test]
    fn only_wav_bodies_are_taken() {
        assert!(is_wav(&wav(0)));
        assert!(!is_wav(b"RIFF"));
        assert!(!is_wav(&[0u8; 64]));
    }

    #[test]
    fn writes_a_new_file_and_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("vcb-download-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let a = write_new(&dir, "voice-check-after-2026-11-18-0312.wav", &wav(4)).unwrap();
        let b = write_new(&dir, "voice-check-after-2026-11-18-0312.wav", &wav(8)).unwrap();
        assert_eq!(a, dir.join("voice-check-after-2026-11-18-0312.wav"));
        assert_eq!(b, dir.join("voice-check-after-2026-11-18-0312-2.wav"));
        assert_eq!(fs::read(&a).unwrap(), wav(4));
        assert_eq!(fs::read(&b).unwrap(), wav(8));
        let missing = dir.join("no-such-folder");
        assert_eq!(
            write_new(&missing, "x.wav", &wav(0)).unwrap_err().code,
            DownloadErrorCode::WriteFailed
        );
        fs::remove_dir_all(&dir).unwrap();
    }
}
