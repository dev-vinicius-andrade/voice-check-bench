// Export / restore state machine with a fake Wave Link process, on temp copies only.
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};

use chrono::NaiveDate;

use super::edit::{apply, ChainChange};
use super::error::WlErrorCode;
use super::export::{export, restore, Options, Step, Timings};
use super::files::{list_backups, read_text, write_backup};
use super::model::{hash_text, list_inputs};
use super::process::ProcessControl;
use super::test_support::{fixture, real_settings, TempDir, MIC, NEW_STATE};
use super::WlResult;

type Hook = Box<dyn Fn()>;

/// A pretend Wave Link: closes/starts on request unless told not to, records calls, runs hooks.
struct Fake {
    running: Cell<bool>,
    closes: bool,
    force_closes: bool,
    starts: bool,
    log: RefCell<Vec<&'static str>>,
    on_close: Option<Hook>,
    on_start: Option<Hook>,
}

impl Fake {
    fn new(running: bool) -> Self {
        Self {
            running: Cell::new(running),
            closes: true,
            force_closes: true,
            starts: true,
            log: RefCell::default(),
            on_close: None,
            on_start: None,
        }
    }
    fn log(&self) -> Vec<&'static str> {
        self.log.borrow().clone()
    }
}

impl ProcessControl for Fake {
    fn is_running(&self) -> WlResult<bool> {
        Ok(self.running.get())
    }
    fn request_close(&self) -> WlResult<()> {
        self.log.borrow_mut().push("close");
        if let Some(h) = &self.on_close {
            h();
        }
        if self.closes {
            self.running.set(false);
        }
        Ok(())
    }
    fn force_close(&self) -> WlResult<()> {
        self.log.borrow_mut().push("force");
        if self.force_closes {
            self.running.set(false);
        }
        Ok(())
    }
    fn start(&self) -> WlResult<()> {
        self.log.borrow_mut().push("start");
        if self.starts {
            self.running.set(true);
        }
        if let Some(h) = &self.on_start {
            h();
        }
        Ok(())
    }
    fn sleep(&self, _: std::time::Duration) {}
}

fn opts(force: bool) -> Options {
    let now = NaiveDate::from_ymd_opt(2026, 11, 10)
        .unwrap()
        .and_hms_opt(16, 5, 0)
        .unwrap();
    Options {
        force,
        timings: Timings::default(),
        now,
    }
}

fn gate_change() -> Vec<ChainChange> {
    vec![ChainChange {
        input_key: MIC.into(),
        index: 0,
        parameter_state: Some(NEW_STATE.into()),
        bypassed: None,
    }]
}

fn backup_of(dir: &Path) -> PathBuf {
    dir.join("Settings.before-2026-11-10-1605.json")
}

#[test]
fn export_success_backs_up_before_writing_and_verifies() {
    let dir = TempDir::new("ok");
    let text = fixture();
    let settings = dir.settings(&text);
    let mut fake = Fake::new(true);
    let (s2, b2, t2) = (settings.clone(), backup_of(dir.path()), text.clone());
    fake.on_close = Some(Box::new(move || {
        assert_eq!(
            std::fs::read_to_string(&b2).unwrap(),
            t2,
            "backup exists before the write"
        );
        assert_eq!(
            std::fs::read_to_string(&s2).unwrap(),
            t2,
            "nothing written before the close"
        );
    }));
    let report = export(
        &settings,
        &fake,
        &gate_change(),
        &hash_text(&text),
        &opts(false),
    )
    .unwrap();
    let expected = apply(&text, &gate_change()).unwrap();
    assert_eq!(read_text(&settings).unwrap(), expected);
    assert_eq!(
        std::fs::read_to_string(backup_of(dir.path())).unwrap(),
        text
    );
    assert_eq!(fake.log(), ["close", "start"]);
    assert_eq!(
        report.steps,
        [
            Step::Checked,
            Step::BackedUp,
            Step::Closed,
            Step::Written,
            Step::Started,
            Step::Verified
        ]
    );
    assert!(report.was_running && report.restarted && report.written && !report.forced);
    assert_eq!(report.hash, hash_text(&expected));
    assert_eq!(report.changes.len(), 1);
    // no temp file left behind
    let names: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names.len(), 2, "{names:?}");
}

#[test]
fn changed_meanwhile_touches_nothing() {
    let dir = TempDir::new("changed");
    let text = fixture();
    let settings = dir.settings(&text);
    let fake = Fake::new(true);
    let e = export(
        &settings,
        &fake,
        &gate_change(),
        &hash_text("something else"),
        &opts(true),
    )
    .unwrap_err();
    assert_eq!(e.code, WlErrorCode::ChangedMeanwhile);
    assert_eq!(read_text(&settings).unwrap(), text);
    assert!(fake.log().is_empty());
    assert!(list_backups(&settings).unwrap().is_empty());
}

#[test]
fn close_timeout_writes_nothing() {
    let dir = TempDir::new("timeout");
    let text = fixture();
    let settings = dir.settings(&text);
    let mut fake = Fake::new(true);
    fake.closes = false;
    let e = export(
        &settings,
        &fake,
        &gate_change(),
        &hash_text(&text),
        &opts(false),
    )
    .unwrap_err();
    assert_eq!(e.code, WlErrorCode::CloseTimeout);
    assert_eq!(read_text(&settings).unwrap(), text);
    assert_eq!(fake.log(), ["close"], "never forced, never restarted");
    assert!(fake.running.get());
}

#[test]
fn force_closes_only_when_allowed() {
    let dir = TempDir::new("force");
    let text = fixture();
    let settings = dir.settings(&text);
    let mut fake = Fake::new(true);
    fake.closes = false;
    let report = export(
        &settings,
        &fake,
        &gate_change(),
        &hash_text(&text),
        &opts(true),
    )
    .unwrap();
    assert!(report.forced);
    assert_eq!(fake.log(), ["close", "force", "start"]);
    assert!(report.steps.contains(&Step::Forced));
    // a forced close that fails still writes nothing
    let dir2 = TempDir::new("force-fail");
    let settings2 = dir2.settings(&text);
    let mut stuck = Fake::new(true);
    stuck.closes = false;
    stuck.force_closes = false;
    let e = export(
        &settings2,
        &stuck,
        &gate_change(),
        &hash_text(&text),
        &opts(true),
    )
    .unwrap_err();
    assert_eq!(e.code, WlErrorCode::CloseTimeout);
    assert_eq!(read_text(&settings2).unwrap(), text);
}

#[test]
fn verify_failed_when_wave_link_puts_the_old_file_back() {
    let dir = TempDir::new("verify");
    let text = fixture();
    let settings = dir.settings(&text);
    let mut fake = Fake::new(true);
    let (s2, t2) = (settings.clone(), text.clone());
    fake.on_start = Some(Box::new(move || std::fs::write(&s2, &t2).unwrap()));
    let e = export(
        &settings,
        &fake,
        &gate_change(),
        &hash_text(&text),
        &opts(false),
    )
    .unwrap_err();
    assert_eq!(e.code, WlErrorCode::VerifyFailed);
}

#[test]
fn start_failed_is_reported_after_the_write() {
    let dir = TempDir::new("start");
    let text = fixture();
    let settings = dir.settings(&text);
    let mut fake = Fake::new(true);
    fake.starts = false;
    let e = export(
        &settings,
        &fake,
        &gate_change(),
        &hash_text(&text),
        &opts(false),
    )
    .unwrap_err();
    assert_eq!(e.code, WlErrorCode::StartFailed);
    assert_eq!(
        read_text(&settings).unwrap(),
        apply(&text, &gate_change()).unwrap()
    );
}

#[test]
fn not_running_is_written_without_close_or_start() {
    let dir = TempDir::new("idle");
    let text = fixture();
    let settings = dir.settings(&text);
    let fake = Fake::new(false);
    let report = export(
        &settings,
        &fake,
        &gate_change(),
        &hash_text(&text),
        &opts(false),
    )
    .unwrap();
    assert!(fake.log().is_empty());
    assert!(!report.was_running && report.written);
    assert_eq!(
        list_inputs(&read_text(&settings).unwrap()).unwrap()[0].entries[0].parameter_state,
        NEW_STATE
    );
}

#[test]
fn no_op_changes_write_nothing() {
    let dir = TempDir::new("noop");
    let text = fixture();
    let settings = dir.settings(&text);
    let fake = Fake::new(true);
    let same = vec![ChainChange {
        input_key: MIC.into(),
        index: 1,
        parameter_state: None,
        bypassed: Some(true),
    }];
    let report = export(&settings, &fake, &same, &hash_text(&text), &opts(false)).unwrap();
    assert!(!report.written && report.backup_path.is_none());
    assert!(fake.log().is_empty());
}

#[test]
fn save_on_exit_is_backed_up_and_the_changes_reapplied() {
    let dir = TempDir::new("rebase");
    let text = fixture();
    let settings = dir.settings(&text);
    let mut fake = Fake::new(true);
    let saved_on_exit = text.replace("\"Count\": 1.50", "\"Count\": 2");
    let (s2, t2) = (settings.clone(), saved_on_exit.clone());
    fake.on_close = Some(Box::new(move || std::fs::write(&s2, &t2).unwrap()));
    let report = export(
        &settings,
        &fake,
        &gate_change(),
        &hash_text(&text),
        &opts(false),
    )
    .unwrap();
    assert_eq!(
        read_text(&settings).unwrap(),
        apply(&saved_on_exit, &gate_change()).unwrap()
    );
    let extra = report.extra_backup_path.expect("second backup");
    assert!(extra.ends_with("Settings.before-2026-11-10-1605-2.json"));
    assert_eq!(std::fs::read_to_string(extra).unwrap(), saved_on_exit);
}

#[test]
fn failure_after_close_starts_wave_link_again() {
    let dir = TempDir::new("gone");
    let text = fixture();
    let settings = dir.settings(&text);
    let mut fake = Fake::new(true);
    let s2 = settings.clone();
    fake.on_close = Some(Box::new(move || std::fs::remove_file(&s2).unwrap()));
    let e = export(
        &settings,
        &fake,
        &gate_change(),
        &hash_text(&text),
        &opts(false),
    )
    .unwrap_err();
    assert_eq!(e.code, WlErrorCode::NotFound);
    assert_eq!(fake.log(), ["close", "start"]);
}

#[test]
fn restore_writes_the_backup_back_and_backs_up_the_current_file() {
    let dir = TempDir::new("restore");
    let text = fixture();
    let settings = dir.settings(&text);
    let report = export(
        &settings,
        &Fake::new(true),
        &gate_change(),
        &hash_text(&text),
        &opts(false),
    )
    .unwrap();
    let backup = PathBuf::from(report.backup_path.unwrap());
    let changed = read_text(&settings).unwrap();
    let fake = Fake::new(true);
    let r = restore(&settings, &fake, &backup, &opts(false)).unwrap();
    assert_eq!(read_text(&settings).unwrap(), text);
    assert_eq!(fake.log(), ["close", "start"]);
    assert_eq!(
        std::fs::read_to_string(r.backup_path.unwrap()).unwrap(),
        changed
    );
    assert_eq!(r.changes.len(), 1);
    assert_eq!(r.steps.last(), Some(&Step::Verified));
    assert_eq!(list_backups(&settings).unwrap().len(), 2);
}

#[test]
fn restore_refuses_files_that_are_not_backups_next_to_settings() {
    let dir = TempDir::new("refuse");
    let other = TempDir::new("elsewhere");
    let settings = dir.settings(&fixture());
    let outside = other.path().join("Settings.before-2026-01-01-0000.json");
    std::fs::write(&outside, fixture()).unwrap();
    let fake = Fake::new(true);
    assert_eq!(
        restore(&settings, &fake, &outside, &opts(false))
            .unwrap_err()
            .code,
        WlErrorCode::InvalidChange
    );
    assert_eq!(
        restore(&settings, &fake, &settings, &opts(false))
            .unwrap_err()
            .code,
        WlErrorCode::InvalidChange
    );
    let missing = dir.path().join("Settings.before-2000-01-01-0000.json");
    assert_eq!(
        restore(&settings, &fake, &missing, &opts(false))
            .unwrap_err()
            .code,
        WlErrorCode::NotFound
    );
    let junk = dir.path().join("Settings.before-2000-01-02-0000.json");
    std::fs::write(&junk, "{}").unwrap();
    assert_eq!(
        restore(&settings, &fake, &junk, &opts(false))
            .unwrap_err()
            .code,
        WlErrorCode::Parse
    );
    assert!(fake.log().is_empty());
}

#[test]
fn backups_are_listed_newest_first_and_never_overwritten() {
    let dir = TempDir::new("list");
    let settings = dir.settings(&fixture());
    let now = opts(false).now;
    let a = write_backup(&settings, "one", now).unwrap();
    let b = write_backup(&settings, "two", now).unwrap();
    std::fs::write(dir.path().join("notes.json"), "x").unwrap();
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "one");
    assert_ne!(a, b);
    let names: Vec<_> = list_backups(&settings)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert_eq!(names.len(), 2);
    assert!(names
        .iter()
        .all(|n| n.starts_with("Settings.before-2026-11-10-1605")));
}

#[test]
fn export_on_a_copy_of_the_real_file() {
    let Some(real) = real_settings() else {
        eprintln!(
            "SKIPPED export_on_a_copy_of_the_real_file: no Wave Link Settings.json on this PC"
        );
        return;
    };
    let dir = TempDir::new("real-export");
    let text = String::from_utf8(std::fs::read(&real).unwrap()).unwrap();
    let settings = dir.settings(&text);
    let inputs = list_inputs(&text).unwrap();
    let mic = &inputs[0];
    let e = mic
        .entries
        .iter()
        .find(|e| !e.parameter_state.is_empty())
        .unwrap();
    let change = vec![ChainChange {
        input_key: mic.key.clone(),
        index: e.index,
        parameter_state: None,
        bypassed: Some(!e.bypassed),
    }];
    let fake = Fake::new(true);
    let report = export(&settings, &fake, &change, &hash_text(&text), &opts(false)).unwrap();
    assert_eq!(report.changes.len(), 1);
    let after = read_text(&settings).unwrap();
    assert_eq!(
        after.len(),
        text.len() + if e.bypassed { 1 } else { 0 } - if e.bypassed { 0 } else { 1 }
    );
    let r = restore(
        &settings,
        &Fake::new(true),
        Path::new(&report.backup_path.unwrap()),
        &opts(false),
    )
    .unwrap();
    assert!(r.written);
    assert_eq!(read_text(&settings).unwrap(), text);
}
