// "Save to Wave Link" with the JSON the UI sends over IPC (wavelink_export's `changes`: WlChainChange in
// src/desktop/types.ts) and the report fields the UI reads (`written`, `steps`), on temp copies with a Wave Link that
// is not running. Regression for the recording screen's Save that showed "Saved" for an export that wrote nothing.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::NaiveDate;
use serde_json::{json, Value};

use super::edit::ChainChange;
use super::export::{export, Options, Step, Timings};
use super::files::{list_backups, read_text};
use super::model::{hash_text, list_inputs};
use super::process::ProcessControl;
use super::test_support::{fixture, real_settings, TempDir, MIC, NEW_STATE};
use super::WlResult;

/// Wave Link not running: export never closes or starts anything (as render_cli's `wavelink_export`).
struct NotRunning;

impl ProcessControl for NotRunning {
    fn is_running(&self) -> WlResult<bool> {
        Ok(false)
    }
    fn request_close(&self) -> WlResult<()> {
        panic!("closed a Wave Link that is not running")
    }
    fn force_close(&self) -> WlResult<()> {
        panic!("forced a Wave Link that is not running")
    }
    fn start(&self) -> WlResult<()> {
        panic!("started Wave Link")
    }
    fn sleep(&self, _: std::time::Duration) {}
}

fn opts() -> Options {
    let now = NaiveDate::from_ymd_opt(2026, 11, 18)
        .unwrap()
        .and_hms_opt(3, 12, 0)
        .unwrap();
    Options {
        force: false,
        timings: Timings::default(),
        now,
    }
}

/// `changes` as the webview's JSON.stringify writes them (camelCase, optional fields left out).
fn from_ui(changes: Value) -> Vec<ChainChange> {
    serde_json::from_value(changes).expect("the UI's WlChainChange JSON deserializes")
}

/// The state with its last byte changed (still valid base64 of the same length).
fn other_state(state: &str) -> String {
    let mut bytes = STANDARD.decode(state).expect("stored state is base64");
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    STANDARD.encode(bytes)
}

/// Every change holds in the file at `text` (read back with list_inputs, independent of export's own check).
fn assert_holds(text: &str, changes: &[ChainChange]) {
    let inputs = list_inputs(text).unwrap();
    for c in changes {
        let e = &inputs
            .iter()
            .find(|i| i.key == c.input_key)
            .unwrap()
            .entries[c.index];
        if let Some(s) = &c.parameter_state {
            assert_eq!(&e.parameter_state, s, "effect {} state", c.index);
        }
        if let Some(b) = c.bypassed {
            assert_eq!(e.bypassed, b, "effect {} bypass", c.index);
        }
    }
}

#[test]
fn ui_json_changes_are_written_and_reported_as_written() {
    let dir = TempDir::new("ui-json");
    let text = fixture();
    let settings = dir.settings(&text);
    let changes = from_ui(json!([
        { "inputKey": MIC, "index": 0, "parameterState": NEW_STATE },
        { "inputKey": MIC, "index": 1, "bypassed": false },
    ]));
    let report = export(&settings, &NotRunning, &changes, &hash_text(&text), &opts()).unwrap();
    assert!(report.written);
    assert_eq!(
        report.steps,
        vec![Step::Checked, Step::BackedUp, Step::Written, Step::Verified]
    );
    assert_holds(&read_text(&settings).unwrap(), &changes);
    assert_eq!(list_backups(&settings).unwrap().len(), 1);
    // the fields and step names the UI reads (WlFlowReport in src/desktop/types.ts)
    let v = serde_json::to_value(&report).unwrap();
    assert_eq!(v["written"], json!(true));
    assert_eq!(
        v["steps"],
        json!(["checked", "backedUp", "written", "verified"])
    );
    assert!(v["backupPath"].is_string());
}

#[test]
fn a_second_save_of_the_same_changes_writes_nothing_and_says_so() {
    let dir = TempDir::new("ui-twice");
    let text = fixture();
    let settings = dir.settings(&text);
    let changes = from_ui(json!([{ "inputKey": MIC, "index": 0, "parameterState": NEW_STATE }]));
    export(&settings, &NotRunning, &changes, &hash_text(&text), &opts()).unwrap();
    let saved = read_text(&settings).unwrap();
    let again = export(
        &settings,
        &NotRunning,
        &changes,
        &hash_text(&saved),
        &opts(),
    )
    .unwrap();
    // nothing written: no backup, no close, only "checked" (the UI must not say "Saved" for this report)
    assert!(!again.written && again.backup_path.is_none());
    assert_eq!(again.steps, vec![Step::Checked]);
    let v = serde_json::to_value(&again).unwrap();
    assert_eq!(v["written"], json!(false));
    assert_eq!(v["steps"], json!(["checked"]));
    assert_eq!(read_text(&settings).unwrap(), saved);
    assert_eq!(list_backups(&settings).unwrap().len(), 1);
}

#[test]
fn the_tuners_change_set_on_a_copy_of_the_real_file() {
    let Some(real) = real_settings() else {
        eprintln!("SKIPPED the_tuners_change_set_on_a_copy_of_the_real_file: no Wave Link Settings.json on this PC");
        return;
    };
    let dir = TempDir::new("ui-real");
    let text = String::from_utf8(std::fs::read(&real).unwrap()).unwrap();
    let settings = dir.settings(&text);
    let inputs = list_inputs(&text).unwrap();
    let mic = &inputs[0];
    // what Save writes for a tune result: new states for the ReaEQ / ReaComp / Noise Removal it moved, ReaFIR off
    let mut ui = Vec::new();
    for e in &mic.entries {
        let name = e.name.to_lowercase();
        if (name.contains("reaeq") || name.contains("reacomp") || name.contains("noise removal"))
            && !e.parameter_state.is_empty()
        {
            ui.push(json!({ "inputKey": mic.key, "index": e.index, "parameterState": other_state(&e.parameter_state) }));
        } else if name.contains("reafir") {
            ui.push(json!({ "inputKey": mic.key, "index": e.index, "bypassed": !e.bypassed }));
        }
    }
    if ui.is_empty() {
        eprintln!("SKIPPED the_tuners_change_set_on_a_copy_of_the_real_file: no ReaPlugs / Noise Removal on the mic");
        return;
    }
    let changes = from_ui(Value::Array(ui));
    let report = export(&settings, &NotRunning, &changes, &hash_text(&text), &opts()).unwrap();
    assert!(report.written && report.steps.contains(&Step::Verified));
    assert_eq!(report.changes.len(), changes.len());
    let after = read_text(&settings).unwrap();
    assert_ne!(after, text);
    assert_holds(&after, &changes);
    let again = export(
        &settings,
        &NotRunning,
        &changes,
        &hash_text(&after),
        &opts(),
    )
    .unwrap();
    assert!(!again.written && again.steps == vec![Step::Checked]);
}
