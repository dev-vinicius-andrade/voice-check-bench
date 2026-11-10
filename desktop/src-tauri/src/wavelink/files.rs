// File side of the Wave Link flow: locate Settings.json, read it without locking it, dated backups next to it
// (web naming rule), atomic writes (temp file + rename in the same folder) and the backup list.
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use chrono::NaiveDateTime;
use serde::Serialize;

use super::error::{err, WlErrorCode, WlResult};
use super::process::PACKAGE_FAMILY;

/// Environment variable that points the app at another Settings.json (a copy, for manual tests).
pub const PATH_OVERRIDE_ENV: &str = "VCB_WAVELINK_SETTINGS";
const BACKUP_PREFIX: &str = "Settings.before-";
const BACKUP_SUFFIX: &str = ".json";

/// `%LOCALAPPDATA%\Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json`, or `VCB_WAVELINK_SETTINGS`.
pub fn default_settings_path() -> WlResult<PathBuf> {
    if let Some(p) = std::env::var_os(PATH_OVERRIDE_ENV).filter(|p| !p.is_empty()) {
        return Ok(PathBuf::from(p));
    }
    match std::env::var_os("LOCALAPPDATA") {
        Some(base) => Ok(PathBuf::from(base)
            .join("Packages")
            .join(PACKAGE_FAMILY)
            .join("LocalState")
            .join("Settings.json")),
        None => err(WlErrorCode::NotFound, "LOCALAPPDATA is not set"),
    }
}

/// The file's text. std opens with full sharing on Windows, so a running Wave Link is never blocked.
pub fn read_text(path: &Path) -> WlResult<String> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            return err(
                WlErrorCode::NotFound,
                format!("cannot read {}: {e}", path.display()),
            )
        }
    };
    String::from_utf8(bytes).or_else(|_| {
        err(
            WlErrorCode::Parse,
            format!("{} is not UTF-8 text", path.display()),
        )
    })
}

/// `Settings.before-<yyyy-mm-dd-hhmm>.json` in local time (backupName in src/components/wavelink/wlFiles.ts).
pub fn backup_name(now: NaiveDateTime) -> String {
    format!(
        "{BACKUP_PREFIX}{}{BACKUP_SUFFIX}",
        now.format("%Y-%m-%d-%H%M")
    )
}

pub fn is_backup_name(name: &str) -> bool {
    name.len() > BACKUP_PREFIX.len() + BACKUP_SUFFIX.len()
        && name.starts_with(BACKUP_PREFIX)
        && name.ends_with(BACKUP_SUFFIX)
}

/// Writes `text` as a new backup next to `settings`. Never overwrites: a second backup in the same minute gets
/// `-2`, `-3`… before `.json`.
pub fn write_backup(settings: &Path, text: &str, now: NaiveDateTime) -> WlResult<PathBuf> {
    let dir = parent(settings);
    let base = backup_name(now);
    let stem = base.trim_end_matches(BACKUP_SUFFIX);
    for n in 1..100 {
        let path = dir.join(if n == 1 {
            base.clone()
        } else {
            format!("{stem}-{n}{BACKUP_SUFFIX}")
        });
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                return f
                    .write_all(text.as_bytes())
                    .and_then(|_| f.sync_all())
                    .map(|_| path.clone())
                    .or_else(|e| {
                        err(
                            WlErrorCode::WriteFailed,
                            format!("cannot write backup {}: {e}", path.display()),
                        )
                    });
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return err(
                    WlErrorCode::WriteFailed,
                    format!("cannot create backup {}: {e}", path.display()),
                )
            }
        }
    }
    err(
        WlErrorCode::WriteFailed,
        "too many backups in the same minute",
    )
}

/// Replaces `path` with `text`: a temp file in the same folder, flushed, then renamed over the original.
pub fn write_atomic(path: &Path, text: &str) -> WlResult<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = parent(path).join(format!("{name}.vcb-{}.tmp", std::process::id()));
    let result = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    result.or_else(|e| {
        let _ = fs::remove_file(&tmp);
        err(
            WlErrorCode::WriteFailed,
            format!("cannot write {}: {e}", path.display()),
        )
    })
}

fn parent(path: &Path) -> &Path {
    path.parent().unwrap_or_else(|| Path::new("."))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub name: String,
    /// Last write time, ms since the Unix epoch.
    pub modified_ms: u64,
    pub size: u64,
}

/// `Settings.before-*.json` files next to `settings`, newest first.
pub fn list_backups(settings: &Path) -> WlResult<Vec<BackupInfo>> {
    let dir = parent(settings);
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            return err(
                WlErrorCode::NotFound,
                format!("cannot list {}: {e}", dir.display()),
            )
        }
    };
    let mut out: Vec<BackupInfo> = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let meta = e
                .metadata()
                .ok()
                .filter(|m| m.is_file() && is_backup_name(&name))?;
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            Some(BackupInfo {
                path: e.path().to_string_lossy().into_owned(),
                name,
                modified_ms,
                size: meta.len(),
            })
        })
        .collect();
    out.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| b.name.cmp(&a.name))
    });
    Ok(out)
}

/// `backup` when it is a backup file in the same folder as `settings`; anything else is refused.
pub fn check_backup_path(settings: &Path, backup: &Path) -> WlResult<PathBuf> {
    let name = backup
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let canon = |p: &Path| fs::canonicalize(p).ok();
    let (Some(dir), Some(file)) = (canon(parent(settings)), canon(backup)) else {
        return err(
            WlErrorCode::NotFound,
            format!("backup {} not found", backup.display()),
        );
    };
    if !is_backup_name(&name) || file.parent() != Some(dir.as_path()) {
        return err(
            WlErrorCode::InvalidChange,
            format!(
                "{} is not a Settings backup next to Settings.json",
                backup.display()
            ),
        );
    }
    Ok(backup.to_path_buf())
}
