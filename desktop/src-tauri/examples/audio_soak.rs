//! Soak run of the real audio engine (PLAN task 39 verification), monitor Off: nothing is played (the output
//! device only receives zeros). Reads the Wave Link mic chain from Settings.json (read-only).
//!
//! ```text
//! cargo run --release --example audio_soak -- [--seconds 600] [--phase 30] [--input <id>] [--output <id>]
//! ```
//!
//! Every `--phase` seconds the chain moves to the next state (0 = stay on the stored chain), so compensation runs
//! live: the stored chain, everything bypassed, ReaFIR alone, the dynamics alone, Noise Removal processing alone.
//! Alignment is measured on the UI stream frames themselves (raw vs processed cross-correlation peak, settled
//! frames, 500 ms after each change skipped). With everything bypassed, processed must equal raw sample by sample.

use std::collections::BTreeMap;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use voice_check_bench_desktop_lib::audio::commands::mic_chain;
use voice_check_bench_desktop_lib::audio::{
    CountersSnapshot, Engine, EngineOptions, Monitor, StreamFrame, DEFAULT_GAIN_DB,
};
use voice_check_bench_desktop_lib::chain::{ChainEntrySpec, SlotStatus};

/// Normalized correlation a frame's peak needs before its lag counts (residual noise after ReaFIR's subtraction
/// barely correlates with the raw noise, so its peak says nothing).
const MIN_CORRELATION: f64 = 0.5;
/// Frames right after a state change are not measured (Noise Removal flips ~120 ms late, ReaFIR flushes 85 ms).
const QUIET_AFTER_CHANGE: Duration = Duration::from_millis(500);

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn xcorr(a: &[f32], b: &[f32], lag: i64) -> f64 {
    let n = a.len() as i64;
    (0..n)
        .filter(|i| (0..n).contains(&(i + lag)))
        .map(|i| a[i as usize] as f64 * b[(i + lag) as usize] as f64)
        .sum()
}

/// Peak lag among ±16 around 0 and around ± every subset sum of the slot latencies (where a compensation error
/// would put it), with its normalized correlation.
fn best_lag(a: &[f32], b: &[f32], latencies: &[u32]) -> (i64, f64) {
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
    let (lag, peak) = cands
        .into_iter()
        .map(|lag| (lag, xcorr(a, b, lag)))
        .max_by(|x, y| x.1.partial_cmp(&y.1).unwrap())
        .unwrap_or((0, 0.0));
    let energy = |x: &[f32]| x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>();
    let norm = (energy(a) * energy(b)).sqrt();
    (lag, if norm > 0.0 { peak / norm } else { 0.0 })
}

/// A chain state: per hosted slot, `Some(bypassed)`; `None` = the stored state (Settings.json bypass + state).
struct Phase {
    name: &'static str,
    bypass: Option<Vec<bool>>,
}

fn phases(hosted_names: &[String]) -> Vec<Phase> {
    let only = |pred: &dyn Fn(&str) -> bool| -> Vec<bool> {
        hosted_names
            .iter()
            .map(|n| !pred(&n.to_ascii_lowercase()))
            .collect()
    };
    vec![
        Phase {
            name: "stored",
            bypass: None,
        },
        Phase {
            name: "all bypassed",
            bypass: Some(vec![true; hosted_names.len()]),
        },
        Phase {
            name: "ReaFIR alone",
            bypass: Some(only(&|n| n.contains("reafir"))),
        },
        Phase {
            name: "ReaComp+ReaGate",
            bypass: Some(only(&|n| n.contains("reacomp") || n.contains("reagate"))),
        },
        Phase {
            name: "Noise Removal alone",
            bypass: Some(only(&|n| n.contains("noise removal"))),
        },
    ]
}

fn apply(engine: &Engine, phase: &Phase, hosted: &[usize], specs: &[ChainEntrySpec]) {
    for (k, &slot) in hosted.iter().enumerate() {
        match &phase.bypass {
            Some(b) => {
                engine.set_bypass(slot, b[k]).expect("set bypass");
            }
            None => {
                // Back to Settings.json: slot bypass, then the stored state (it carries the plugin's own bypass).
                engine
                    .set_bypass(slot, specs[slot].bypassed)
                    .expect("set bypass");
                engine
                    .load_state(slot, &specs[slot].parameter_state)
                    .expect("load stored state");
            }
        }
    }
}

#[derive(Default)]
struct PhaseStats {
    lags: BTreeMap<i64, u64>,
    weak: u64,
    exact_frames: u64,
    inexact_frames: u64,
}

fn counters_key(c: &CountersSnapshot) -> (u64, u64, u64, u64, u64) {
    (
        c.input_overruns,
        c.output_underruns,
        c.monitor_dropped,
        c.stream_dropped,
        c.stream_errors,
    )
}

fn main() {
    let seconds: u64 = arg("--seconds").and_then(|s| s.parse().ok()).unwrap_or(600);
    let phase_secs: u64 = arg("--phase").and_then(|s| s.parse().ok()).unwrap_or(30);
    let (source, specs) = mic_chain().expect("Wave Link mic chain (Settings.json, read-only)");
    println!(
        "chain: {} ({}), {} entries",
        source.input_label,
        source.settings_path,
        specs.len()
    );

    let (tx, rx) = mpsc::channel::<StreamFrame>();
    let opts = EngineOptions {
        input_id: arg("--input"),
        output_id: arg("--output"),
        monitor: Monitor::Off,
        gain_db: DEFAULT_GAIN_DB,
        source: Some(source),
    };
    let sink = Box::new(move |f| {
        let _ = tx.send(f);
    });
    let engine = Engine::start(&specs, &opts, sink).expect("start engine");
    let status = engine.status();
    println!("input : {} ({})", status.input.name, status.input.id);
    println!(
        "output: {} ({}) - monitor {:?}, nothing is played",
        status.output.name, status.output.id, status.monitor
    );
    let hosted: Vec<usize> = status
        .slots
        .iter()
        .filter(|s| matches!(s.info.status, SlotStatus::Hosted { .. }))
        .map(|s| s.info.index)
        .collect();
    let hosted_names: Vec<String> = hosted
        .iter()
        .map(|i| status.slots[*i].info.name.clone())
        .collect();
    let latencies: Vec<u32> = status
        .slots
        .iter()
        .map(|s| s.info.full_latency_samples)
        .collect();
    for s in &status.slots {
        println!(
            "  slot {:2} {:28} bypassed {:5} latency {:5} full {:5}",
            s.info.index,
            s.info.name,
            s.info.bypassed,
            s.info.latency_samples,
            s.info.full_latency_samples
        );
    }
    let aligned = status.latency.aligned_samples;
    println!(
        "aligned latency {aligned} samples ({:.1} ms); running {seconds} s, next chain state every {phase_secs} s",
        aligned as f64 / 48.0
    );

    let plan = phases(&hosted_names);
    let mut current = 0usize;
    let start = Instant::now();
    let mut quiet_until = start + QUIET_AFTER_CHANGE;
    let mut next_phase = phase_secs;
    let mut next_print = 30;
    let mut stats: BTreeMap<&'static str, PhaseStats> = BTreeMap::new();
    let mut latency_seen: BTreeMap<u32, u64> = BTreeMap::new();
    let (mut frames, mut unsettled) = (0u64, 0u64);
    let mut seen = engine.counters();
    let mut after_startup: Option<CountersSnapshot> = None;
    while start.elapsed() < Duration::from_secs(seconds) {
        let Ok(f) = rx.recv_timeout(Duration::from_secs(2)) else {
            println!("no frame for 2 s");
            continue;
        };
        frames += 1;
        *latency_seen.entry(f.latency_samples).or_default() += 1;
        let elapsed = start.elapsed().as_secs();
        let phase = &plan[current];
        if !f.settled || f.latency_changed || Instant::now() < quiet_until {
            unsettled += 1;
        } else {
            let st = stats.entry(phase.name).or_default();
            if phase.name == "all bypassed" {
                if f.raw == f.processed {
                    st.exact_frames += 1;
                } else {
                    st.inexact_frames += 1;
                }
            }
            let (lag, r) = best_lag(&f.raw, &f.processed, &latencies);
            if r >= MIN_CORRELATION {
                *st.lags.entry(lag).or_default() += 1;
            } else {
                st.weak += 1;
            }
        }
        let c = f.counters;
        if counters_key(&c) != counters_key(&seen) {
            println!(
                "[{:6.1} s] event: overruns {} underruns {} monitor-dropped {} stream-dropped {} errors {}",
                start.elapsed().as_secs_f64(),
                c.input_overruns,
                c.output_underruns,
                c.monitor_dropped,
                c.stream_dropped,
                c.stream_errors
            );
        }
        seen = c;
        if after_startup.is_none() && start.elapsed() >= Duration::from_secs(2) {
            after_startup = Some(c);
        }
        if phase_secs > 0 && elapsed >= next_phase {
            current = (current + 1) % plan.len();
            apply(&engine, &plan[current], &hosted, &specs);
            let s = engine.status();
            println!(
                "[{elapsed:4} s] chain -> {:20} active {:5} + compensation {:5} = aligned {}",
                plan[current].name,
                s.latency.active_samples,
                s.latency.aligned_samples - s.latency.active_samples.min(s.latency.aligned_samples),
                s.latency.aligned_samples
            );
            quiet_until = Instant::now() + QUIET_AFTER_CHANGE;
            next_phase += phase_secs;
        }
        if elapsed >= next_print {
            println!(
                "[{elapsed:4} s] blocks {} overruns {} underruns {} monitor-dropped {} stream-dropped {} errors {} | process p50 {:.0} p99 {:.0} max {:.0} us | raw {:.1} dBFS processed {:.1} dBFS",
                c.blocks, c.input_overruns, c.output_underruns, c.monitor_dropped, c.stream_dropped, c.stream_errors,
                c.process_p50_us, c.process_p99_us, c.process_max_us, f.raw_rms_db, f.processed_rms_db
            );
            next_print += 30;
        }
    }
    let fin = engine.counters();
    let last_error = engine.status().last_stream_error;
    engine.stop();
    println!(
        "\n==== soak result ({} s, monitor Off) ====",
        start.elapsed().as_secs()
    );
    println!(
        "blocks {} (expected about {}), input overruns {}, output underruns {}, monitor dropped {}, stream dropped {}, stream errors {}",
        fin.blocks,
        start.elapsed().as_millis() / 10,
        fin.input_overruns,
        fin.output_underruns,
        fin.monitor_dropped,
        fin.stream_dropped,
        fin.stream_errors
    );
    if let Some(s) = after_startup {
        println!(
            "after the first 2 s: input overruns {}, output underruns {}, monitor dropped {}, stream errors {}",
            fin.input_overruns - s.input_overruns,
            fin.output_underruns - s.output_underruns,
            fin.monitor_dropped - s.monitor_dropped,
            fin.stream_errors - s.stream_errors
        );
    }
    println!(
        "processing per block: p50 {:.0} us, p99 {:.0} us ({:.2} % of the 10 ms block; limit 20 %), max {:.0} us",
        fin.process_p50_us,
        fin.process_p99_us,
        fin.process_p99_us / fin.block_us * 100.0,
        fin.process_max_us
    );
    println!("aligned latency seen (samples -> frames): {latency_seen:?}");
    println!("frames {frames}; {unsettled} skipped (settling or within 500 ms of a change)");
    for (name, st) in &stats {
        let exact = if *name == "all bypassed" {
            format!(
                ", processed == raw exactly in {}/{} frames",
                st.exact_frames,
                st.exact_frames + st.inexact_frames
            )
        } else {
            String::new()
        };
        println!(
            "  {name:20} lag -> frames {:?}; {} frames below correlation {MIN_CORRELATION}{exact}",
            st.lags, st.weak
        );
    }
    if let Some(e) = last_error {
        println!("last stream error: {e}");
    }
}
