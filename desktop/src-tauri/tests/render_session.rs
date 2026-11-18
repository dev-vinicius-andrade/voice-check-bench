//! Offline render session on the real mic chain: same-length aligned output, repeatable runs, settings changes
//! between runs, and two sessions of the same plugins at once.
//!
//! Skips (prints `SKIP:` and passes) without Wave Link: Settings from `VCB_SETTINGS_COPY`, else a read-only copy of
//! the real file in the cargo target tmp dir (the real file is never written). Signal: `VCB_TEST_TAKE`, else
//! `_test/control-2-cm-raw.wav` (local, never committed), else synthetic speech-like bursts.

use std::path::PathBuf;

use voice_check_bench_desktop_lib::chain::{ChainEntrySpec, SlotStatus};
use voice_check_bench_desktop_lib::host::PluginKind;
use voice_check_bench_desktop_lib::render::RenderSession;
use voice_check_bench_desktop_lib::wavelink::list_inputs;

/// Filters (ReaEQ, Elgato EQ, De-Esser, Noise Removal) move the speech cross-correlation peak by about a sample each;
/// a latency mistake would move it by a slot latency (480 or 4096 samples).
const PHASE_TOLERANCE: i64 = 8;
/// Largest |difference| allowed between two runs of the same samples and settings (measured: exactly 0).
const REPEAT_TOLERANCE: f32 = 1e-6;

fn skip(msg: &str) {
    println!("SKIP: {msg}");
}

fn mic_chain() -> Option<Vec<ChainEntrySpec>> {
    let text = if let Some(p) = std::env::var_os("VCB_SETTINGS_COPY") {
        std::fs::read_to_string(p).ok()?
    } else {
        let real = PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
            .join(r"Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json");
        if !real.is_file() {
            return None;
        }
        let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
        std::fs::create_dir_all(&dir).ok()?;
        let copy = dir.join(format!(
            "Settings.render.{}.{:?}.json",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::copy(&real, &copy).ok()?;
        let text = std::fs::read_to_string(&copy).ok();
        let _ = std::fs::remove_file(&copy);
        text?
    };
    let mic = list_inputs(&text).ok()?.into_iter().next()?;
    Some(
        mic.entries
            .into_iter()
            .map(|e| ChainEntrySpec {
                name: e.name,
                file_path: e.file_path,
                bypassed: e.bypassed,
                parameter_state: e.parameter_state,
            })
            .collect(),
    )
}

fn load_signal() -> Vec<f32> {
    let path = std::env::var_os("VCB_TEST_TAKE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../_test/control-2-cm-raw.wav")
        });
    if let Ok(mut r) = hound::WavReader::open(&path) {
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
        return all.iter().step_by(ch).copied().collect();
    }
    println!("signal: synthetic bursts (no take at {})", path.display());
    let mut x = 1u32;
    (0..48_000 * 6)
        .map(|k| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let n = (x >> 8) as f32 / (1u32 << 24) as f32 - 0.5;
            let on = (k / 9600) % 2 == 0;
            let tone = (k as f32 * 2.0 * std::f32::consts::PI * 180.0 / 48_000.0).sin();
            if on {
                0.15 * tone + 0.1 * n
            } else {
                0.003 * n
            }
        })
        .collect()
}

/// A session on the mic chain with its hosted slot indexes, or None (skip) without Wave Link or hostable plugins.
fn open() -> Option<(RenderSession, Vec<usize>)> {
    let Some(specs) = mic_chain() else {
        skip("no Wave Link Settings.json (set VCB_SETTINGS_COPY to a copy)");
        return None;
    };
    let s = RenderSession::open(&specs).expect("open render session");
    let hosted: Vec<usize> = s
        .status()
        .slots
        .iter()
        .filter(|x| matches!(x.info.status, SlotStatus::Hosted { .. }))
        .map(|x| x.info.index)
        .collect();
    if hosted.is_empty() {
        skip("no hostable plugin on the mic input");
        return None;
    }
    Some((s, hosted))
}

/// Start of the loudest `len`-sample window (stepping by 100 ms).
fn loudest(x: &[f32], len: usize) -> usize {
    let energy = |a: usize| {
        x[a..a + len]
            .iter()
            .map(|v| (*v as f64).powi(2))
            .sum::<f64>()
    };
    (0..x.len().saturating_sub(len))
        .step_by(4800)
        .max_by(|a, b| energy(*a).partial_cmp(&energy(*b)).unwrap())
        .unwrap_or(0)
}

fn xcorr(a: &[f32], b: &[f32], lag: i64) -> f64 {
    let n = a.len() as i64;
    (0..n)
        .filter(|i| (0..n).contains(&(i + lag)))
        .map(|i| a[i as usize] as f64 * b[(i + lag) as usize] as f64)
        .sum()
}

/// Lag of the highest cross-correlation among ±16 around 0 and around every ± subset sum of `latencies` (where a
/// latency mistake would put the peak).
fn best_lag(a: &[f32], b: &[f32], latencies: &[u32]) -> i64 {
    let mut sums = vec![0i64];
    for l in latencies.iter().filter(|l| **l > 0) {
        let more: Vec<i64> = sums.iter().map(|s| s + *l as i64).collect();
        sums.extend(more);
    }
    let mut cands: Vec<i64> = sums
        .iter()
        .flat_map(|s| [*s, -*s])
        .flat_map(|c| (c - 16)..=(c + 16))
        .filter(|c| c.unsigned_abs() < (a.len() / 2) as u64)
        .collect();
    cands.sort_unstable();
    cands.dedup();
    cands
        .into_iter()
        .map(|lag| (lag, xcorr(a, b, lag)))
        .max_by(|x, y| x.1.partial_cmp(&y.1).unwrap())
        .map_or(0, |c| c.0)
}

fn max_diff(a: &[f32], b: &[f32]) -> f32 {
    assert_eq!(a.len(), b.len());
    a.iter()
        .zip(b)
        .map(|(x, y)| (x - y).abs())
        .fold(0f32, f32::max)
}

/// Lag of `out` against `input` on their loudest second.
fn lag_of(input: &[f32], out: &[f32], latencies: &[u32]) -> i64 {
    let len = 48_000.min(input.len() / 2);
    let at = loudest(input, len);
    best_lag(&input[at..at + len], &out[at..at + len], latencies)
}

#[test]
fn everything_bypassed_renders_the_input_sample_exact_at_any_length() {
    let Some((mut s, hosted)) = open() else {
        return;
    };
    for &k in &hosted {
        s.set_bypass(k, true).expect("bypass");
    }
    assert_eq!(s.status().latency_samples, 0);
    let take = load_signal();
    let out = s.run(&take).expect("run");
    assert_eq!(out, take, "everything bypassed: the input, sample-exact");
    for n in [1usize, 479, 481, 12_345] {
        assert_eq!(s.run(&take[..n]).expect("run").as_slice(), &take[..n]);
    }
    assert!(s.run(&[]).expect("empty run").is_empty());
}

#[test]
fn output_is_aligned_for_the_stored_chain_and_each_slot_alone() {
    let Some((mut s, hosted)) = open() else {
        return;
    };
    let take = load_signal();
    let latencies: Vec<u32> = s
        .status()
        .slots
        .iter()
        .map(|x| x.info.full_latency_samples)
        .collect();
    for x in s.status().slots {
        println!(
            "slot {} {:28} bypassed {:5} latency {:5} full {:5} {:?}",
            x.info.index,
            x.info.name,
            x.info.bypassed,
            x.info.latency_samples,
            x.info.full_latency_samples,
            x.info.status
        );
    }
    let out = s.run(&take).expect("run");
    assert_eq!(out.len(), take.len(), "same length as the input");
    let lag = lag_of(&take, &out, &latencies);
    println!(
        "stored chain: latency {} removed, lag {lag}",
        s.status().latency_samples
    );
    assert!(lag.abs() <= PHASE_TOLERANCE, "stored chain lag {lag}");

    // Each hosted slot alone (the others bypassed), on a 3 s excerpt around the loudest part.
    let at = loudest(&take, 3 * 48_000);
    let piece = &take[at..at + 3 * 48_000];
    let mut bad = vec![];
    for &solo in &hosted {
        for &k in &hosted {
            s.set_bypass(k, k != solo).expect("bypass");
        }
        let out = s.run(piece).expect("run");
        assert_eq!(out.len(), piece.len());
        let lag = lag_of(piece, &out, &latencies);
        let info = s.slot(solo).unwrap().info;
        println!(
            "solo {:28} latency {:5} removed, lag {lag}",
            info.name,
            s.status().latency_samples
        );
        if lag.abs() > PHASE_TOLERANCE {
            bad.push(format!("{}: {lag}", info.name));
        }
    }
    assert!(bad.is_empty(), "misaligned: {bad:?}");
}

#[test]
fn runs_are_repeatable_whatever_ran_before() {
    let Some((mut s, _)) = open() else {
        return;
    };
    let take = load_signal();
    let first = s.run(&take).expect("run");
    let again = s.run(&take).expect("run");
    // Something very different in between: the take reversed, 12 dB louder (clamped), with a noise floor.
    let mut x = 7u32;
    let other: Vec<f32> = take
        .iter()
        .rev()
        .map(|v| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let n = (x >> 8) as f32 / (1u32 << 24) as f32 - 0.5;
            (v * 4.0 + 0.05 * n).clamp(-1.0, 1.0)
        })
        .collect();
    s.run(&other).expect("other run");
    let after = s.run(&take).expect("run");
    let peak = first.iter().fold(0f32, |m, v| m.max(v.abs()));
    let (d1, d2) = (max_diff(&first, &again), max_diff(&first, &after));
    println!("output peak {peak:.4}; max |diff| back to back {d1:e}, after another take {d2:e}");
    assert!(d1 <= REPEAT_TOLERANCE, "back to back: {d1:e}");
    assert!(d2 <= REPEAT_TOLERANCE, "after another take: {d2:e}");
}

#[test]
fn a_parameter_change_takes_effect_on_the_next_run() {
    let Some((mut s, hosted)) = open() else {
        return;
    };
    // A ReaPlugs "Wet" (output level) on a processing slot: ReaComp first, else ReaGate.
    let pick = ["ReaComp", "ReaGate"].iter().find_map(|name| {
        hosted.iter().find_map(|&k| {
            let slot = s.slot(k).ok()?;
            let vst2 = matches!(
                slot.info.status,
                SlotStatus::Hosted {
                    kind: PluginKind::Vst2,
                    ..
                }
            );
            if !vst2 || slot.info.bypassed || !slot.info.name.contains(name) {
                return None;
            }
            let p = slot.params.iter().find(|p| p.name == "Wet")?;
            Some((k, p.id, p.normalized, slot.info.name))
        })
    });
    let Some((slot, id, wet, name)) = pick else {
        skip("no processing ReaComp/ReaGate with a Wet parameter");
        return;
    };
    let take = load_signal();
    let base = s.run(&take).expect("run");
    s.set_param(slot, id, wet * 0.5).expect("set Wet");
    let changed = s.run(&take).expect("run");
    let d = max_diff(&base, &changed);
    println!("{name} Wet {wet:.4} -> {:.4}: max |diff| {d:.4}", wet * 0.5);
    assert!(d > 1e-3, "the new Wet changes the output");
    s.set_param(slot, id, wet).expect("restore Wet");
    let back = s.run(&take).expect("run");
    let d = max_diff(&base, &back);
    println!("{name} Wet back to {wet:.4}: max |diff| {d:e}");
    assert!(d <= REPEAT_TOLERANCE, "back to the old value: {d:e}");
}

#[test]
fn two_sessions_of_the_same_plugins_run_at_once() {
    let Some((mut a, _)) = open() else {
        return;
    };
    let Some((mut b, _)) = open() else {
        return;
    };
    let take = load_signal();
    let alone = a.run(&take).expect("run");
    let (out_a, out_b) = std::thread::scope(|sc| {
        let t = sc.spawn(|| b.run(&take).expect("run b"));
        let out_a = a.run(&take).expect("run a");
        (out_a, t.join().expect("thread b"))
    });
    let (da, db) = (max_diff(&alone, &out_a), max_diff(&alone, &out_b));
    println!("two sessions at once: max |diff| vs one alone: a {da:e}, b {db:e}");
    assert!(da <= REPEAT_TOLERANCE && db <= REPEAT_TOLERANCE);
}

#[test]
fn noise_removal_switched_on_after_a_while_bypassed_processes_from_the_first_run() {
    let Some(specs) = mic_chain() else {
        skip("no Wave Link Settings.json (set VCB_SETTINGS_COPY to a copy)");
        return;
    };
    let Some(nr) = specs
        .iter()
        .position(|e| e.name.contains("Noise Removal") && !e.file_path.trim().is_empty())
    else {
        skip("no Elgato Noise Removal on the mic input");
        return;
    };
    let solo = |s: &mut RenderSession, on: bool| {
        let hosted: Vec<usize> = s
            .status()
            .slots
            .iter()
            .filter(|x| matches!(x.info.status, SlotStatus::Hosted { .. }))
            .map(|x| x.info.index)
            .collect();
        for k in hosted {
            s.set_bypass(k, k != nr || !on).expect("bypass");
        }
    };
    let take = load_signal();
    let piece = &take[..take.len().min(6 * 48_000)];
    // Reference: a fresh session, Noise Removal alone and processing.
    let mut fresh = RenderSession::open(&specs).expect("open");
    if !matches!(
        fresh.slot(nr).unwrap().info.status,
        SlotStatus::Hosted { .. }
    ) {
        skip("Noise Removal is not hostable here");
        return;
    }
    solo(&mut fresh, true);
    let reference = fresh.run(piece).expect("run");
    drop(fresh);

    // Bypassed for 7 s (it then follows "on" up to ~0.5 s late on the clock), switched on, rendered at once.
    let mut s = RenderSession::open(&specs).expect("open");
    solo(&mut s, true);
    s.run(piece).expect("run");
    solo(&mut s, false);
    std::thread::sleep(std::time::Duration::from_secs(7));
    solo(&mut s, true);
    let t0 = std::time::Instant::now();
    let first = s.run(piece).expect("run");
    let d = max_diff(&reference, &first);
    println!(
        "first run after switching Noise Removal on: max |diff| vs fresh {d:e} ({:.0} ms)",
        t0.elapsed().as_secs_f64() * 1e3
    );
    assert!(d <= REPEAT_TOLERANCE, "Noise Removal followed late: {d:e}");
}
