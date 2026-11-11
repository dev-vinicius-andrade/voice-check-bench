//! Audio engine pipeline on the real mic chain, offline: delay-compensated bypass keeps the chain latency constant
//! and raw/processed aligned for every bypass combination of the hosted slots.
//!
//! Skips (prints `SKIP:` and passes) without Wave Link: Settings from `VCB_SETTINGS_COPY`, else a read-only copy of
//! the real file in the cargo target tmp dir (the real file is never written). Signal: `VCB_TEST_TAKE`, else
//! `_test/control-2-cm-raw.wav` (local, never committed), else synthetic speech-like bursts.

use std::path::PathBuf;
use std::sync::Arc;

use rtrb::RingBuffer;
use voice_check_bench_desktop_lib::audio::pipeline::COMMAND_QUEUE;
use voice_check_bench_desktop_lib::audio::{Counters, Monitor, Pipeline, StreamBlock};
use voice_check_bench_desktop_lib::chain::{build_chain, ChainEntrySpec, SlotStatus};
use voice_check_bench_desktop_lib::host::{PluginKind, BLOCK};
use voice_check_bench_desktop_lib::wavelink::list_inputs;

/// The cross-correlation peak of speech moves by a few samples through minimum-phase filters (ReaEQ, Elgato EQ,
/// De-Esser, Noise Removal each shift it by about one sample on their own). A compensation error would move it by a
/// slot latency (480 or 4096 samples) instead. The pure-delay unit test (`audio::pipeline` tests) checks lag 0 and
/// sample equality exactly; here everything-bypassed must be sample-exact too.
const PHASE_TOLERANCE: i64 = 8;

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
        let copy = dir.join(format!("Settings.audio.{}.json", std::process::id()));
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
        println!("signal: {}", path.display());
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

/// Start of the loudest `len`-sample window (stepping by 100 ms), at least `min_start` in.
fn loudest(x: &[f32], len: usize, min_start: usize) -> usize {
    let energy = |a: usize| {
        x[a..a + len]
            .iter()
            .map(|v| (*v as f64).powi(2))
            .sum::<f64>()
    };
    (min_start..x.len().saturating_sub(len))
        .step_by(4800)
        .max_by(|a, b| energy(*a).partial_cmp(&energy(*b)).unwrap())
        .unwrap_or(min_start)
}

fn xcorr(a: &[f32], b: &[f32], lag: i64) -> f64 {
    let n = a.len() as i64;
    (0..n)
        .filter(|i| (0..n).contains(&(i + lag)))
        .map(|i| a[i as usize] as f64 * b[(i + lag) as usize] as f64)
        .sum()
}

/// Lag of the highest cross-correlation among ±16 around 0 and around every ± subset sum of `latencies` (where a
/// compensation mistake would put the peak).
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

#[test]
fn compensated_bypass_keeps_latency_and_alignment_for_every_combination() {
    let Some(specs) = mic_chain() else {
        skip("no Wave Link Settings.json (set VCB_SETTINGS_COPY to a copy)");
        return;
    };
    let (ctl, processor) = build_chain(&specs).expect("build chain");
    ctl.wait_settled();
    let slots = ctl.slots();
    let hosted: Vec<usize> = slots
        .iter()
        .filter(|s| matches!(s.status, SlotStatus::Hosted { .. }))
        .map(|s| s.index)
        .collect();
    if hosted.is_empty() {
        skip("no hostable plugin on the mic input");
        return;
    }
    for s in &slots {
        println!(
            "slot {} {:28} bypassed {:5} latency {:5} full {:5} {:?}",
            s.index, s.name, s.bypassed, s.latency_samples, s.full_latency_samples, s.status
        );
    }
    let full = ctl.full_latency_samples();
    let latencies: Vec<u32> = slots.iter().map(|s| s.full_latency_samples).collect();

    let (_cmd_tx, cmd_rx) = RingBuffer::new(COMMAND_QUEUE);
    let (blk_tx, mut blk_rx) = RingBuffer::<StreamBlock>::new(512);
    let counters = Arc::new(Counters::default());
    let mut pipeline = Pipeline::new(
        processor,
        cmd_rx,
        blk_tx,
        counters.clone(),
        Monitor::Processed,
        1.0,
    );

    let signal = load_signal();
    let warm = (full as usize).div_ceil(BLOCK) + 60; // chain latency + 600 ms for the plugins to follow
    let measure = 50; // 0.5 s of speech
    let start = loudest(&signal, measure * BLOCK, warm * BLOCK);
    assert!(start + measure * BLOCK <= signal.len(), "signal too short");
    let mut out = vec![0.0f32; BLOCK];

    let n = hosted.len();
    let combos: Vec<u32> = (0..1u32 << n).map(|k| k ^ (k >> 1)).collect(); // Gray code: one toggle per step
    println!(
        "{} hosted slots, {} combinations, full latency {full}",
        n,
        combos.len() + 1
    );
    let mut worst = 0i64;
    let mut bad: Vec<String> = vec![];
    // The stored state first (as Wave Link has it), then every combination of slot bypasses.
    for (step, combo) in std::iter::once(None)
        .chain(combos.into_iter().map(Some))
        .enumerate()
    {
        let mut vst3 = false;
        if let Some(c) = combo {
            for (bit, &slot) in hosted.iter().enumerate() {
                let on = c & (1 << bit) != 0;
                let info = ctl.slot(slot).unwrap();
                if info.bypassed != on {
                    ctl.set_bypass(slot, on).expect("set bypass");
                    vst3 |= matches!(
                        info.status,
                        SlotStatus::Hosted {
                            kind: PluginKind::Vst3,
                            ..
                        }
                    );
                }
            }
        }
        let (mut raw, mut processed) = (vec![], vec![]);
        let from = start - warm * BLOCK;
        for (b, piece) in signal[from..start + measure * BLOCK]
            .chunks(BLOCK)
            .enumerate()
        {
            pipeline.process_block(piece, &mut out);
            if vst3 && b < warm {
                // After a VST3 bypass change the warm-up runs at real-time pace: Noise Removal follows its bypass
                // through the message thread while it keeps processing. 300 ms was not always enough after its first
                // "bypass off" in the full chain; the 700 ms warm-up is.
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            let blk = blk_rx.pop().expect("one stream block per block");
            assert_eq!(
                blk.latency, full,
                "step {step}: aligned latency stays constant"
            );
            if b >= warm {
                raw.extend_from_slice(&blk.raw);
                processed.extend_from_slice(&blk.processed);
            }
        }
        let label = match combo {
            None => "stored".to_string(),
            Some(c) => format!("{c:0n$b}", n = n),
        };
        let active = ctl.latency_samples();
        let lag = best_lag(&raw, &processed, &latencies);
        let all_bypassed = combo == Some((1 << n) - 1);
        println!(
            "step {step:3} bypass {label:>8}  active {active:5} + compensation {:5} = {full}  lag {lag}",
            full - active.min(full)
        );
        if all_bypassed {
            assert_eq!(
                raw, processed,
                "everything bypassed: processed is the raw signal, sample-exact"
            );
        }
        if let Some(c) = combo.filter(|c| c.count_zeros() - (32 - n as u32) == 1) {
            let solo = hosted[c.trailing_ones() as usize];
            println!("  solo {}: lag {lag}", slots[solo].name);
        }
        worst = worst.max(lag.abs());
        if lag.abs() > PHASE_TOLERANCE {
            bad.push(format!("{label}: {lag}"));
        }
    }
    println!("worst |lag| over all combinations: {worst} (tolerance {PHASE_TOLERANCE})");
    assert!(bad.is_empty(), "misaligned: {bad:?}");
    assert_eq!(counters.snapshot().stream_dropped, 0);
}
