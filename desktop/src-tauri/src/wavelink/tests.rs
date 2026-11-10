// Read, apply and diff on the synthesized fixture, plus the same checks on a temp copy of the real Settings.json
// when this PC has Wave Link (skipped otherwise).
use super::edit::{apply, base64_len, diff, dotnet_string, encode_like, ChainChange, DiffField};
use super::error::{WlError, WlErrorCode};
use super::files::backup_name;
use super::model::{all_chains, list_inputs};
use super::process::parse_tasklist;
use super::scan;
use super::test_support::{fixture, real_settings, TempDir, GATE_STATE, MIC, NEW_STATE};

fn change(input: &str, index: usize, state: Option<&str>, bypassed: Option<bool>) -> ChainChange {
    ChainChange {
        input_key: input.into(),
        index,
        parameter_state: state.map(Into::into),
        bypassed,
    }
}

fn code<T: std::fmt::Debug>(r: Result<T, WlError>) -> WlErrorCode {
    r.expect_err("expected an error").code
}

/// The single byte range where `a` and `b` differ: (start, end in a, end in b).
fn changed_range(a: &str, b: &str) -> (usize, usize, usize) {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let pre = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let suf = a[pre..]
        .iter()
        .rev()
        .zip(b[pre..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    (pre, a.len() - suf, b.len() - suf)
}

#[test]
fn lists_inputs_mic_first_with_decoded_entries() {
    let inputs = list_inputs(&fixture()).unwrap();
    let keys: Vec<_> = inputs.iter().map(|i| i.key.as_str()).collect();
    // System (PCM_OUT, no effects) is left out; the mic with ReaPlugs comes before Game.
    assert_eq!(keys, [MIC, "PCM_OUT_00_V_06_SD4"]);
    let mic = &inputs[0];
    assert_eq!(mic.label, "2- Elgato Wave:XLR");
    assert_eq!(mic.entries.len(), 3);
    let gate = &mic.entries[0];
    assert_eq!(
        (gate.index, gate.name.as_str(), gate.vendor.as_str()),
        (0, "ReaGate (ReaPlugs Edition)", "Cockos")
    );
    assert_eq!(gate.parameter_state, GATE_STATE);
    assert_eq!(
        gate.file_path,
        r"C:\Program Files\Common Files\VST2\reagate-standalone.dll"
    );
    assert_eq!(gate.plugin_id, "72656774");
    assert!(!gate.bypassed);
    assert!(mic.entries[1].bypassed);
    assert_eq!(mic.entries[2].parameter_state, "");
}

#[test]
fn not_wave_link_or_not_json_is_parse() {
    assert_eq!(code(list_inputs("{\"a\": 1}")), WlErrorCode::Parse);
    assert_eq!(code(list_inputs("{\"a\": ")), WlErrorCode::Parse);
}

#[test]
fn bom_is_kept_and_skipped() {
    let text = format!("\u{feff}{}", fixture());
    assert_eq!(list_inputs(&text).unwrap().len(), 2);
    let mic = MIC.to_string();
    let out = apply(&text, &[change(&mic, 0, Some(NEW_STATE), None)]).unwrap();
    assert!(out.starts_with('\u{feff}'));
}

#[test]
fn same_state_is_byte_identical() {
    let text = fixture();
    let mic = MIC.to_string();
    let out = apply(&text, &[change(&mic, 0, Some(GATE_STATE), Some(false))]).unwrap();
    assert_eq!(out, text);
    // and re-encoding the decoded value reproduces the file's own escaping
    let root = scan::parse(&text).unwrap();
    let node = root
        .get("MixerConfiguration")
        .unwrap()
        .get("InputSettings")
        .unwrap()
        .get(&mic)
        .unwrap();
    let ps = node
        .get("AudioPluginConfigurations")
        .unwrap()
        .items()
        .unwrap()[0]
        .get("ParameterState")
        .unwrap();
    assert_eq!(encode_like(&text, GATE_STATE), &text[ps.start..ps.end]);
}

#[test]
fn new_state_changes_only_that_string() {
    let text = fixture();
    let mic = MIC.to_string();
    let out = apply(&text, &[change(&mic, 0, Some(NEW_STATE), None)]).unwrap();
    let (start, end_a, end_b) = changed_range(&text, &out);
    let expected_old = "Q2NuSwAA\\u002B/8=";
    let expected_new = "Q2NuSwAB\\u002B\\u002B\\u002B/";
    // the differing bytes sit inside the gate's ParameterState literal
    let lit = text.find(expected_old).unwrap();
    assert!(start >= lit && end_a <= lit + expected_old.len());
    assert_eq!(&out[lit..lit + expected_new.len()], expected_new);
    assert_eq!(out.len() - end_b, text.len() - end_a);
    // the Game ReaComp with the same state is untouched
    assert_eq!(out.matches(expected_old).count(), 1);
    let game = &all_chains(&out).unwrap()[2];
    assert_eq!(game.entries[0].parameter_state, GATE_STATE);
    assert_eq!(
        list_inputs(&out).unwrap()[0].entries[0].parameter_state,
        NEW_STATE
    );
}

#[test]
fn bypass_flips_only_the_literal() {
    let text = fixture();
    let mic = MIC.to_string();
    let out = apply(&text, &[change(&mic, 1, None, Some(false))]).unwrap();
    let (start, end_a, end_b) = changed_range(&text, &out);
    assert_eq!(&text[start..end_a], "tru");
    assert_eq!(&out[start..end_b], "fals");
    assert!(!list_inputs(&out).unwrap()[0].entries[1].bypassed);
}

#[test]
fn plain_json_files_keep_a_raw_plus() {
    let text = fixture()
        .replace("\\u002B", "+")
        .replace("\\u0022", "\\\"")
        .replace("\\u003C", "<")
        .replace("\\u003E", ">");
    let mic = MIC.to_string();
    let out = apply(&text, &[change(&mic, 0, Some(NEW_STATE), None)]).unwrap();
    assert!(out.contains("\"Q2NuSwAB+++/\""));
    assert!(!out.contains("\\u002B"));
}

#[test]
fn refuses_missing_ambiguous_and_invalid_changes() {
    let text = fixture();
    let mic = MIC.to_string();
    assert_eq!(
        code(apply(&text, &[change("nope", 0, Some(NEW_STATE), None)])),
        WlErrorCode::MissingEntry
    );
    assert_eq!(
        code(apply(&text, &[change(&mic, 9, Some(NEW_STATE), None)])),
        WlErrorCode::MissingEntry
    );
    assert_eq!(
        code(apply(&text, &[change(&mic, 0, Some("not base64!"), None)])),
        WlErrorCode::InvalidChange
    );
    assert_eq!(
        code(apply(&text, &[change(&mic, 0, Some(""), None)])),
        WlErrorCode::InvalidChange
    );
    assert_eq!(
        code(apply(&text, &[change(&mic, 0, None, None)])),
        WlErrorCode::InvalidChange
    );
    let twice = [
        change(&mic, 0, Some(NEW_STATE), None),
        change(&mic, 0, Some(GATE_STATE), None),
    ];
    assert_eq!(code(apply(&text, &twice)), WlErrorCode::InvalidChange);
    // Game's ReaComp has no Id etc. but also no PluginId: fine; a duplicated ParameterState key is ambiguous
    let dup = text.replace("\"BypassState\": false\r\n          }\r\n        ]\r\n      }\r\n    }", "\"BypassState\": false,\r\n\"ParameterState\": \"AAAA\"\r\n          }\r\n        ]\r\n      }\r\n    }");
    assert_ne!(dup, text);
    assert_eq!(
        code(apply(
            &dup,
            &[change("PCM_OUT_00_V_06_SD4", 0, Some(NEW_STATE), None)]
        )),
        WlErrorCode::MissingEntry
    );
    // a duplicated input key is ambiguous too
    let dup_input = text.replace(
        "\"PCM_OUT_00_V_06_SD4\"",
        &format!("\"{}\"", MIC.replace('\\', "\\\\")),
    );
    assert_eq!(
        code(apply(&dup_input, &[change(&mic, 0, Some(NEW_STATE), None)])),
        WlErrorCode::MissingEntry
    );
}

#[test]
fn diff_lists_state_and_bypass_changes() {
    let text = fixture();
    let mic = MIC.to_string();
    let out = apply(
        &text,
        &[
            change(&mic, 0, Some(NEW_STATE), None),
            change(&mic, 1, None, Some(false)),
        ],
    )
    .unwrap();
    let lines = diff(&text, &out).unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(
        (lines[0].field, lines[0].plugin.as_str()),
        (DiffField::ParameterState, "ReaGate (ReaPlugs Edition)")
    );
    assert_eq!(
        (lines[0].from.as_str(), lines[0].to.as_str()),
        ("8 bytes", "changed (9 bytes)")
    );
    assert_eq!((lines[0].from_bytes, lines[0].to_bytes), (Some(8), Some(9)));
    assert_eq!(lines[0].input, "2- Elgato Wave:XLR");
    assert_eq!(
        (lines[1].field, lines[1].from.as_str(), lines[1].to.as_str()),
        (DiffField::Bypass, "off", "on")
    );
    assert!(diff(&text, &text).unwrap().is_empty());
}

#[test]
fn helpers_match_the_web_rules() {
    assert_eq!(
        dotnet_string("a+b\"c'<>&`é\n"),
        "\"a\\u002Bb\\u0022c\\u0027\\u003C\\u003E\\u0026\\u0060\\u00E9\\n\""
    );
    assert_eq!(base64_len("AAAA"), Some(3));
    assert_eq!(base64_len("AA=="), Some(1));
    assert_eq!(base64_len("A==="), None);
    let t = chrono::NaiveDate::from_ymd_opt(2026, 1, 2)
        .unwrap()
        .and_hms_opt(3, 4, 5)
        .unwrap();
    assert_eq!(backup_name(t), "Settings.before-2026-01-02-0304.json");
    let csv = "\"Elgato.WaveLink.exe\",\"4340\",\"Console\",\"1\",\"300,000 K\"\r\n\"other.exe\",\"1\",\"x\"\r\n";
    assert_eq!(parse_tasklist(csv), [4340]);
    assert!(
        parse_tasklist("INFO: No tasks are running which match the specified criteria.").is_empty()
    );
}

#[test]
fn errors_serialize_with_stable_codes() {
    let e = WlError::new(WlErrorCode::ChangedMeanwhile, "x");
    assert_eq!(
        serde_json::to_string(&e).unwrap(),
        r#"{"code":"changedMeanwhile","message":"x"}"#
    );
    let codes = [
        (WlErrorCode::NotFound, "notFound"),
        (WlErrorCode::Parse, "parse"),
        (WlErrorCode::MissingEntry, "missingEntry"),
        (WlErrorCode::InvalidChange, "invalidChange"),
        (WlErrorCode::CloseTimeout, "closeTimeout"),
        (WlErrorCode::WriteFailed, "writeFailed"),
        (WlErrorCode::StartFailed, "startFailed"),
        (WlErrorCode::VerifyFailed, "verifyFailed"),
    ];
    for (c, s) in codes {
        assert_eq!(serde_json::to_value(c).unwrap(), s);
    }
}

/// Read-only probe of the real Wave Link (never closes or starts it). Run by hand: `cargo test -- --ignored probe`.
#[test]
#[ignore]
fn probe_real_wave_link_read_only() {
    use super::process::{ProcessControl, WaveLinkProcess};
    eprintln!(
        "running: {:?}, aumid: {}",
        WaveLinkProcess.is_running(),
        WaveLinkProcess::aumid()
    );
}

#[test]
fn real_settings_copy_round_trips() {
    let Some(real) = real_settings() else {
        eprintln!("SKIPPED real_settings_copy_round_trips: no Wave Link Settings.json on this PC");
        return;
    };
    let dir = TempDir::new("real");
    let copy = dir.path().join("Settings.json");
    std::fs::write(&copy, std::fs::read(&real).expect("read real file")).unwrap();
    let text = std::fs::read_to_string(&copy).unwrap();
    let inputs = list_inputs(&text).unwrap();
    let mic = inputs.first().expect("an input");
    assert!(mic.key.contains("PCM_IN"), "mic first: {}", mic.key);
    let root = scan::parse(&text).unwrap();
    let settings = root
        .get("MixerConfiguration")
        .unwrap()
        .get("InputSettings")
        .unwrap();
    let mut checked = 0;
    for inp in &inputs {
        let items = settings
            .get(&inp.key)
            .unwrap()
            .get("AudioPluginConfigurations")
            .unwrap()
            .items()
            .unwrap();
        for e in &inp.entries {
            let ps = items[e.index].get("ParameterState").unwrap();
            assert_eq!(
                encode_like(&text, &e.parameter_state),
                &text[ps.start..ps.end],
                "escaping of {}",
                e.name
            );
            if e.parameter_state.is_empty() {
                continue;
            }
            let same = apply(
                &text,
                &[change(
                    &inp.key,
                    e.index,
                    Some(&e.parameter_state),
                    Some(e.bypassed),
                )],
            )
            .unwrap();
            assert_eq!(same, text, "{} with itself", e.name);
            checked += 1;
        }
    }
    assert!(checked > 0);
    // a different state for the first stateful effect changes only that literal
    let e = mic
        .entries
        .iter()
        .find(|e| !e.parameter_state.is_empty())
        .unwrap();
    let other = if e.parameter_state.starts_with('Q') {
        "AAAA+/8="
    } else {
        "QUJD+/8="
    };
    let out = apply(&text, &[change(&mic.key, e.index, Some(other), None)]).unwrap();
    let ps = settings
        .get(&mic.key)
        .unwrap()
        .get("AudioPluginConfigurations")
        .unwrap()
        .items()
        .unwrap()[e.index]
        .get("ParameterState")
        .unwrap();
    assert_eq!(&out[..ps.start], &text[..ps.start]);
    assert_eq!(&out[out.len() - (text.len() - ps.end)..], &text[ps.end..]);
    let lines = diff(&text, &out).unwrap();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].field, DiffField::ParameterState);
}
