//! Plugin host engine against the real plugins and a COPY of the local Wave Link Settings.json.
//!
//! Every test skips (prints `SKIP:` and passes) when what it needs is missing, so CI without Wave Link passes:
//! - Settings: `VCB_SETTINGS_COPY` (path to a copy), else the real file is copied (read-only) into the cargo target
//!   tmp dir and read from there. The real file is never written.
//! - Plugins: loaded in place from the `FilePath` of each entry.
//! - Raw take: `VCB_TEST_TAKE`, else `_test/control-2-cm-raw.wav` at the repo root (local, never committed).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::Value;
use voice_check_bench_desktop_lib::chain::{
    build_chain, ChainEntrySpec, ChainProcessor, SlotStatus,
};
use voice_check_bench_desktop_lib::host::thread::host;
use voice_check_bench_desktop_lib::host::vst3::state::decode_parameter_state;
use voice_check_bench_desktop_lib::host::{HostResult, Plugin, BLOCK};

fn skip(msg: &str) {
    println!("SKIP: {msg}");
}

fn settings_text() -> Option<String> {
    if let Some(p) = std::env::var_os("VCB_SETTINGS_COPY") {
        return std::fs::read_to_string(p).ok();
    }
    let real = PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
        .join(r"Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json");
    if !real.is_file() {
        return None;
    }
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    std::fs::create_dir_all(&dir).ok()?;
    let copy = dir.join(format!(
        "Settings.copy.{}.{}.json",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::copy(&real, &copy).ok()?;
    let text = std::fs::read_to_string(&copy).ok();
    let _ = std::fs::remove_file(&copy);
    text
}

/// (spec, stored PluginId) of the mic input's effects, in Wave Link order.
fn mic_entries() -> Option<Vec<(ChainEntrySpec, String)>> {
    let Some(text) = settings_text() else {
        skip("no Wave Link Settings.json (set VCB_SETTINGS_COPY to a copy)");
        return None;
    };
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let s = |p: &Value, k: &str| p[k].as_str().unwrap_or("").to_string();
    let inputs = v["MixerConfiguration"]["InputSettings"].as_object()?;
    let (_, inp) = inputs.iter().find(|(k, i)| {
        k.contains("PCM_IN")
            && i["AudioPluginConfigurations"]
                .as_array()
                .is_some_and(|a| a.iter().any(|p| !s(p, "FilePath").is_empty()))
    })?;
    let list = inp["AudioPluginConfigurations"].as_array()?;
    Some(
        list.iter()
            .map(|p| {
                let spec = ChainEntrySpec {
                    name: s(p, "Name"),
                    file_path: s(p, "FilePath"),
                    bypassed: p["BypassState"].as_bool().unwrap_or(false),
                    parameter_state: s(p, "ParameterState"),
                };
                (spec, s(p, "PluginId"))
            })
            .collect(),
    )
}

/// The entry whose file name contains `file` (case-insensitive), if its plugin file exists.
fn entry(entries: &[(ChainEntrySpec, String)], file: &str) -> Option<(ChainEntrySpec, String)> {
    let found = entries.iter().find(|(s, _)| {
        let name = s
            .file_path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        !name.is_empty() && name.contains(&file.to_ascii_lowercase())
    });
    match found {
        Some((s, _)) if !Path::new(&s.file_path).exists() => {
            skip(&format!("{file}: plugin file {} is missing", s.file_path));
            None
        }
        None => {
            skip(&format!("{file}: not on the mic input"));
            None
        }
        Some(e) => Some(e.clone()),
    }
}

/// Load the entry on the host thread, apply its stored state, run `f`, drop it there.
fn with_plugin<R: Send + 'static>(
    spec: &ChainEntrySpec,
    f: impl FnOnce(&Plugin) -> HostResult<R> + Send + 'static,
) -> R {
    let (path, name, state) = (
        spec.file_path.clone(),
        spec.name.clone(),
        spec.parameter_state.clone(),
    );
    host()
        .run(move || {
            let p = Plugin::load(Path::new(&path), &name)?;
            p.load_state(&state)?;
            f(&p)
        })
        .expect("host thread")
        .expect("plugin call")
}

fn load_take() -> Option<Vec<f32>> {
    let path = std::env::var_os("VCB_TEST_TAKE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../_test/control-2-cm-raw.wav")
        });
    let Ok(mut r) = hound::WavReader::open(&path) else {
        skip(&format!(
            "no raw take at {} (set VCB_TEST_TAKE)",
            path.display()
        ));
        return None;
    };
    let spec = r.spec();
    assert_eq!(spec.sample_rate, 48_000, "take must be 48 kHz");
    let ch = spec.channels as usize;
    let all: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().map(Result::unwrap).collect(),
        hound::SampleFormat::Int => {
            let scale = (1u64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>()
                .map(|s| s.unwrap() as f32 / scale)
                .collect()
        }
    };
    Some(all.iter().step_by(ch).copied().collect())
}

fn db(a: f64) -> f64 {
    if a > 1e-12 {
        20.0 * a.log10()
    } else {
        -240.0
    }
}

fn rms_peak_db(x: &[f32]) -> (f64, f64) {
    let sq: f64 = x.iter().map(|v| (*v as f64) * (*v as f64)).sum();
    let peak = x.iter().fold(0f64, |m, v| m.max(v.abs() as f64));
    (db((sq / x.len().max(1) as f64).sqrt()), db(peak))
}

/// Percentile of 50 ms frame levels (dBFS).
fn frame_pct(x: &[f32], p: f64) -> f64 {
    let mut v: Vec<f64> = x
        .as_chunks::<2400>()
        .0
        .iter()
        .map(|c| rms_peak_db(c).0)
        .collect();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((p / 100.0) * (v.len() - 1) as f64).round() as usize]
}

/// Lag (0..max) of the highest cross-correlation between `x` and `y`, over the loudest second of `x`.
fn best_lag(x: &[f32], y: &[f32], max: usize) -> usize {
    let energy = |a: usize| {
        x[a..a + 48_000]
            .iter()
            .map(|v| (*v as f64) * (*v as f64))
            .sum::<f64>()
    };
    let start = (0..x.len().saturating_sub(48_000 + max))
        .step_by(4800)
        .max_by(|a, b| energy(*a).partial_cmp(&energy(*b)).unwrap())
        .unwrap_or(0);
    let w = &x[start..start + 48_000];
    (0..max)
        .map(|lag| {
            (
                lag,
                w.iter()
                    .zip(&y[start + lag..])
                    .map(|(a, b)| (*a as f64) * (*b as f64))
                    .sum::<f64>(),
            )
        })
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
        .map_or(0, |b| b.0)
}

#[test]
fn vst2_states_round_trip_byte_identical() {
    let Some(entries) = mic_entries() else { return };
    for file in ["reagate", "reacomp", "reaeq"] {
        let Some((spec, plugin_id)) = entry(&entries, file) else {
            continue;
        };
        let (saved, id) = with_plugin(&spec, |p| Ok((p.save_state()?, p.plugin_id())));
        assert_eq!(id, plugin_id, "{file}: PluginId");
        assert_eq!(
            saved, spec.parameter_state,
            "{file}: exported state differs from Wave Link's"
        );
        println!(
            "{file}: byte-identical ({} bytes), PluginId {id}",
            STANDARD.decode(&saved).unwrap().len()
        );
    }
}

#[test]
fn reafir_round_trips_by_parameter_values() {
    let Some(entries) = mic_entries() else { return };
    let Some((spec, _)) = entry(&entries, "reafir") else {
        return;
    };
    let (params, saved) = with_plugin(&spec, |p| Ok((p.params(), p.save_state()?)));
    let reloaded = ChainEntrySpec {
        parameter_state: saved.clone(),
        ..spec.clone()
    };
    let again = with_plugin(&reloaded, |p| Ok(p.params()));
    assert!(!params.is_empty());
    assert_eq!(params, again, "ReaFIR parameters after a save/load cycle");
    println!(
        "reafir: {} params equal; bytes stored {} vs saved {} (profile re-encoded, not compared)",
        params.len(),
        STANDARD.decode(&spec.parameter_state).unwrap().len(),
        STANDARD.decode(&saved).unwrap().len()
    );
}

#[test]
fn reacomp_wet_changes_only_its_bytes() {
    let Some(entries) = mic_entries() else { return };
    let Some((spec, _)) = entry(&entries, "reacomp") else {
        return;
    };
    // +12 dB as a linear gain, what ReaComp's setParameter takes for Wet.
    let (name, saved) = with_plugin(&spec, |p| {
        let name = p
            .params()
            .into_iter()
            .find(|q| q.id == 11)
            .map(|q| q.name)
            .unwrap_or_default();
        p.set_param(11, 3.981_071_7)?;
        Ok((name, p.save_state()?))
    });
    assert!(
        name.to_ascii_lowercase().contains("wet"),
        "param 11 is {name:?}"
    );
    let a = STANDARD.decode(&spec.parameter_state).unwrap();
    let b = STANDARD.decode(&saved).unwrap();
    assert_eq!(a.len(), b.len());
    let diff: Vec<usize> = (0..a.len()).filter(|&k| a[k] != b[k]).collect();
    assert!(!diff.is_empty(), "Wet change must show up");
    assert!(
        diff.iter().all(|k| (256..260).contains(k)),
        "only param 11 (bytes 256..260) may change: {diff:?}"
    );
    assert_eq!(&b[256..260], &3.981_071_7f32.to_be_bytes());
    println!("reacomp: Wet change touched bytes {diff:?}");
}

#[test]
fn vst3_states_round_trip_byte_identical() {
    let Some(entries) = mic_entries() else { return };
    for file in ["elgatonoiseremoval", "elgatoeq", "elgatodeesser"] {
        let Some((spec, plugin_id)) = entry(&entries, file) else {
            continue;
        };
        let (saved, id, bypass) = with_plugin(&spec, |p| {
            let bypass: Vec<String> = p
                .params()
                .into_iter()
                .filter(|q| q.is_bypass)
                .map(|q| format!("{}={}", q.name, q.normalized))
                .collect();
            Ok((p.save_state()?, p.plugin_id(), bypass))
        });
        assert_eq!(id, plugin_id, "{file}: computed PluginId");
        assert_eq!(
            saved, spec.parameter_state,
            "{file}: exported state differs from Wave Link's"
        );
        let comp = decode_parameter_state(&saved).unwrap().component.unwrap();
        println!(
            "{file}: byte-identical (IComponent {} bytes), PluginId {id}, bypass params {bypass:?}",
            comp.len()
        );
    }
}

/// Spike table (spike/vst2-host/FINDINGS.md §2): RMS / peak dBFS per stage on control-2-cm-raw.wav.
const SPIKE_STAGES: [(&str, f64, f64); 5] = [
    ("raw", -28.7, -7.9),
    ("reafir", -31.8, -9.5),
    ("reaeq", -33.0, -11.5),
    ("reacomp", -15.4, 0.0),
    ("reagate", -9.4, 6.0),
];

#[test]
fn offline_chain_reproduces_spike_numbers() {
    let Some(entries) = mic_entries() else { return };
    let Some(take) = load_take() else { return };
    let specs: Vec<ChainEntrySpec> = entries.iter().map(|(s, _)| s.clone()).collect();
    for file in ["reafir", "reaeq", "reacomp", "reagate"] {
        if entry(&entries, file).is_none() {
            return;
        }
    }
    let (ctl, mut proc_) = build_chain(&specs).expect("build chain");
    ctl.wait_settled();
    let slots = ctl.slots();
    for s in &slots {
        println!(
            "slot {} {:30} bypassed {:5} latency {:5} {:?}",
            s.index, s.name, s.bypassed, s.latency_samples, s.status
        );
    }
    let n = take.len();
    let mut padded = take.clone();
    padded.resize(n.div_ceil(BLOCK) * BLOCK, 0.0);
    let mut stages = vec![Vec::with_capacity(padded.len()); slots.len()];
    let mut out = vec![0.0f32; BLOCK];
    for block in padded.chunks(BLOCK) {
        proc_.process_block_tapped(block, &mut out, |k, s| stages[k].extend_from_slice(s));
    }
    let index_of = |file: &str| {
        slots.iter().position(|s| {
            s.file_path.to_ascii_lowercase().contains(file)
                && matches!(s.status, SlotStatus::Hosted { .. })
        })
    };
    let mut worst: f64 = 0.0;
    for (stage, rms, peak) in SPIKE_STAGES {
        let x = if stage == "raw" {
            &take[..]
        } else {
            &stages[index_of(stage).expect(stage)][..n]
        };
        let (r, p) = rms_peak_db(x);
        println!("{stage:8} RMS {r:7.2} (spike {rms:6.1})  peak {p:7.2} (spike {peak:6.1})");
        worst = worst.max((r - rms).abs()).max((p - peak).abs());
        assert!(
            (r - rms).abs() <= 0.2 && (p - peak).abs() <= 0.2,
            "{stage}: RMS {r:.2} / peak {p:.2} vs spike {rms} / {peak}"
        );
    }
    println!("worst deviation from the spike table: {worst:.3} dB");

    if let Some(nr) = index_of("elgatonoiseremoval") {
        // Stored Noise Removal state has its own bypass On: pass-through, only delayed.
        let gate = rms_peak_db(&stages[index_of("reagate").unwrap()][..n]);
        let (r, p) = rms_peak_db(&stages[nr][..n]);
        println!("noise removal (own bypass on) RMS {r:.2} peak {p:.2}");
        assert!((r - gate.0).abs() <= 0.2 && (p - gate.1).abs() <= 0.2);
    }
    let expected: u32 = slots
        .iter()
        .filter(|s| !s.bypassed)
        .map(|s| s.latency_samples)
        .sum();
    assert_eq!(ctl.latency_samples(), expected);
    assert_eq!(proc_.latency_samples(), expected);
    println!(
        "chain latency {expected} samples ({:.1} ms)",
        expected as f64 / 48.0
    );
    let exported = ctl.export_states().expect("export");
    assert_eq!(
        exported.len(),
        slots
            .iter()
            .filter(|s| matches!(s.status, SlotStatus::Hosted { .. }))
            .count()
    );
    println!("exported {} hostable states", exported.len());
}

#[test]
fn noise_removal_bypass_off_removes_noise() {
    let Some(entries) = mic_entries() else { return };
    let Some(take) = load_take() else { return };
    let Some((spec, _)) = entry(&entries, "elgatonoiseremoval") else {
        return;
    };
    let (ctl, mut proc_) = build_chain(&[spec]).expect("build chain");
    // Process the whole take (plus room for the delay) and return the output, untrimmed.
    let run = |proc_: &mut ChainProcessor| {
        let mut padded = take.clone();
        padded.resize((take.len() + 4096).div_ceil(BLOCK) * BLOCK, 0.0);
        let mut out = vec![0.0f32; padded.len()];
        for (i, o) in padded.chunks(BLOCK).zip(out.chunks_mut(BLOCK)) {
            proc_.process_block(i, o);
        }
        out
    };

    ctl.wait_settled();
    assert!(proc_.is_settled());
    assert_eq!(
        ctl.latency_samples(),
        0,
        "own bypass on: undelayed pass-through"
    );
    let through = run(&mut proc_);
    let max_diff = take
        .iter()
        .zip(&through)
        .map(|(a, b)| (a - b).abs())
        .fold(0f32, f32::max);
    println!("own bypass on: latency 0, max |out - in| = {max_diff:e}");
    assert!(
        max_diff < 1e-6,
        "stored state (own bypass on) passes audio through bit-exact"
    );

    ctl.set_bypass(0, false).expect("bypass off");
    assert!(!proc_.is_settled(), "a VST3 bypass change needs settling");
    let latency = ctl.latency_samples() as usize;
    assert_eq!(
        latency, 480,
        "Noise Removal's unreported 480-sample delay while it processes"
    );
    ctl.wait_settled();
    let out = run(&mut proc_);
    let processed = &out[latency..latency + take.len()];
    let lag = best_lag(&take, &out, 2048);
    println!("bypass off: reported latency {latency}, measured lag {lag}");
    let (p10_in, p10_out) = (frame_pct(&take, 10.0), frame_pct(processed, 10.0));
    let (p90_in, p90_out) = (frame_pct(&take, 90.0), frame_pct(processed, 90.0));
    println!(
        "bypass off: p10 {p10_in:.1} -> {p10_out:.1} dBFS, p90 {p90_in:.1} -> {p90_out:.1} dBFS"
    );
    assert!(
        p10_in - p10_out >= 20.0,
        "pause noise must drop by >= 20 dB"
    );
    assert!(
        (p90_in - p90_out).abs() <= 3.0,
        "speech level stays within 3 dB"
    );
    // Cross-correlation on denoised speech peaks within a sample or two of the true delay (filter phase).
    assert!(
        lag.abs_diff(latency) <= 2,
        "reported latency {latency} vs measured delay {lag}"
    );

    let exported = ctl.export_states().expect("export");
    assert_eq!(exported.len(), 1);
    assert!(!exported[0].bypassed);
    let comp = decode_parameter_state(&exported[0].parameter_state)
        .unwrap()
        .component
        .unwrap();
    let xml = String::from_utf8_lossy(&comp);
    assert!(
        xml.contains(r#"<PARAM id="bypass" value="0.0"/>"#),
        "export carries the plugin's own bypass off"
    );
}
