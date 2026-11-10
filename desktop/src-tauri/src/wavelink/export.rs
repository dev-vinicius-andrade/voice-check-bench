// Export and restore as one step sequence: check the file is what the UI saw → backup → close Wave Link →
// write atomically → start Wave Link → re-read and verify. Every step after the close puts Wave Link back on failure.
use std::path::Path;
use std::time::Duration;

use chrono::NaiveDateTime;
use serde::Serialize;

use super::edit::{apply, diff, ChainChange, DiffLine};
use super::error::{err, WlErrorCode, WlResult};
use super::files::{check_backup_path, read_text, write_atomic, write_backup};
use super::model::{all_chains, hash_text};
use super::process::ProcessControl;

#[derive(Debug, Clone, Copy)]
pub struct Timings {
    /// Wait for a polite close (SPEC: 10 s).
    pub close_wait: Duration,
    pub force_wait: Duration,
    pub start_wait: Duration,
    /// Pause after Wave Link is back before the file is re-read (it may rewrite it on start).
    pub settle: Duration,
    pub poll: Duration,
}

impl Default for Timings {
    fn default() -> Self {
        Self {
            close_wait: Duration::from_secs(10),
            force_wait: Duration::from_secs(5),
            start_wait: Duration::from_secs(20),
            settle: Duration::from_secs(3),
            poll: Duration::from_millis(250),
        }
    }
}

pub struct Options {
    /// Kill Wave Link when it does not close politely in time.
    pub force: bool,
    pub timings: Timings,
    /// Local time for the backup name.
    pub now: NaiveDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Checked,
    BackedUp,
    Closed,
    Forced,
    Written,
    Started,
    Verified,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowReport {
    pub path: String,
    /// Backup of the file as it was before this write (None when nothing had to be written).
    pub backup_path: Option<String>,
    /// Second backup, when Wave Link rewrote the file while closing (the changes were re-applied onto it).
    pub extra_backup_path: Option<String>,
    pub was_running: bool,
    pub forced: bool,
    pub restarted: bool,
    pub written: bool,
    /// Restore only: the backup that was written back.
    pub restored_from: Option<String>,
    pub changes: Vec<DiffLine>,
    /// SHA-256 of Settings.json after the flow.
    pub hash: String,
    pub steps: Vec<Step>,
}

/// Polls until Wave Link's running state is `running`, up to `limit`.
fn wait_for(
    proc: &dyn ProcessControl,
    running: bool,
    limit: Duration,
    poll: Duration,
) -> WlResult<bool> {
    let mut waited = Duration::ZERO;
    loop {
        if proc.is_running()? == running {
            return Ok(true);
        }
        if waited >= limit {
            return Ok(false);
        }
        proc.sleep(poll);
        waited += poll;
    }
}

/// Closes Wave Link if it runs (records was_running/forced). Errors with CloseTimeout when it stays open.
fn close(proc: &dyn ProcessControl, opts: &Options, report: &mut FlowReport) -> WlResult<()> {
    let t = opts.timings;
    report.was_running = proc.is_running()?;
    if !report.was_running {
        return Ok(());
    }
    proc.request_close()?;
    if !wait_for(proc, false, t.close_wait, t.poll)? {
        if !opts.force {
            let secs = t.close_wait.as_secs();
            return err(
                WlErrorCode::CloseTimeout,
                format!("Wave Link did not close within {secs} s; nothing was written"),
            );
        }
        proc.force_close()?;
        if !wait_for(proc, false, t.force_wait, t.poll)? {
            return err(
                WlErrorCode::CloseTimeout,
                "Wave Link did not close even when forced; nothing was written",
            );
        }
        report.forced = true;
        report.steps.push(Step::Forced);
    }
    report.steps.push(Step::Closed);
    Ok(())
}

/// Starts Wave Link again if it was running, then lets it settle.
fn start(proc: &dyn ProcessControl, opts: &Options, report: &mut FlowReport) -> WlResult<()> {
    if !report.was_running {
        return Ok(());
    }
    let t = opts.timings;
    proc.start()?;
    if !wait_for(proc, true, t.start_wait, t.poll)? {
        return err(
            WlErrorCode::StartFailed,
            "Settings.json was written, but Wave Link did not start again; start it by hand",
        );
    }
    proc.sleep(t.settle);
    report.restarted = true;
    report.steps.push(Step::Started);
    Ok(())
}

/// Runs `step` after Wave Link was closed; on failure tries to start it again before returning the error.
fn or_restart<T>(proc: &dyn ProcessControl, was_running: bool, step: WlResult<T>) -> WlResult<T> {
    if step.is_err() && was_running {
        let _ = proc.start();
    }
    step
}

/// Every change holds in `text`.
fn verify_changes(text: &str, changes: &[ChainChange]) -> WlResult<()> {
    let chains = all_chains(text)?;
    for c in changes {
        let entry = chains
            .iter()
            .find(|i| i.key == c.input_key)
            .and_then(|i| i.entries.get(c.index));
        let ok = entry.is_some_and(|e| {
            c.parameter_state
                .as_ref()
                .is_none_or(|s| &e.parameter_state == s)
                && c.bypassed.is_none_or(|b| e.bypassed == b)
        });
        if !ok {
            return err(
                WlErrorCode::VerifyFailed,
                format!(
                    "input {} effect {} does not hold the new value",
                    c.input_key, c.index
                ),
            );
        }
    }
    Ok(())
}

/// Writes `changes` into Settings.json at `settings`. `expected_hash` is the hash the UI read.
pub fn export(
    settings: &Path,
    proc: &dyn ProcessControl,
    changes: &[ChainChange],
    expected_hash: &str,
    opts: &Options,
) -> WlResult<FlowReport> {
    let mut report = FlowReport {
        path: settings.display().to_string(),
        ..Default::default()
    };
    let text = read_text(settings)?;
    if hash_text(&text) != expected_hash {
        return err(
            WlErrorCode::ChangedMeanwhile,
            "Settings.json changed since it was read; read it again",
        );
    }
    let new_text = apply(&text, changes)?;
    report.changes = diff(&text, &new_text)?;
    report.steps.push(Step::Checked);
    if new_text == text {
        report.hash = hash_text(&text);
        return Ok(report);
    }
    report.backup_path = Some(
        write_backup(settings, &text, opts.now)?
            .display()
            .to_string(),
    );
    report.steps.push(Step::BackedUp);
    close(proc, opts, &mut report)?;
    let was = report.was_running;
    let mut final_text = new_text;
    let current = or_restart(proc, was, read_text(settings))?;
    if current != text {
        // Wave Link saved while closing: keep that save as a backup and apply the same changes onto it.
        let extra = or_restart(proc, was, write_backup(settings, &current, opts.now))?;
        report.extra_backup_path = Some(extra.display().to_string());
        final_text = or_restart(proc, was, apply(&current, changes))?;
    }
    or_restart(proc, was, write_atomic(settings, &final_text))?;
    report.written = true;
    report.steps.push(Step::Written);
    start(proc, opts, &mut report)?;
    let after = read_text(settings)?;
    verify_changes(&after, changes)?;
    report.hash = hash_text(&after);
    report.steps.push(Step::Verified);
    Ok(report)
}

/// Writes a backup back over Settings.json (backing up the current file first), with the same close/start steps.
pub fn restore(
    settings: &Path,
    proc: &dyn ProcessControl,
    backup: &Path,
    opts: &Options,
) -> WlResult<FlowReport> {
    let backup = check_backup_path(settings, backup)?;
    let mut report = FlowReport {
        path: settings.display().to_string(),
        restored_from: Some(backup.display().to_string()),
        ..Default::default()
    };
    let saved = read_text(&backup)?;
    all_chains(&saved)?; // must be a Wave Link settings file
    let current = read_text(settings).ok();
    if let Some(cur) = &current {
        report.changes = diff(cur, &saved).unwrap_or_default();
        report.backup_path = Some(write_backup(settings, cur, opts.now)?.display().to_string());
        report.steps.push(Step::BackedUp);
    }
    report.steps.push(Step::Checked);
    close(proc, opts, &mut report)?;
    or_restart(proc, report.was_running, write_atomic(settings, &saved))?;
    report.written = true;
    report.steps.push(Step::Written);
    start(proc, opts, &mut report)?;
    let after = read_text(settings)?;
    let same_chains = all_chains(&after)? == all_chains(&saved)?;
    if !same_chains {
        return err(
            WlErrorCode::VerifyFailed,
            "Settings.json does not hold the restored effects",
        );
    }
    report.hash = hash_text(&after);
    report.steps.push(Step::Verified);
    Ok(report)
}
