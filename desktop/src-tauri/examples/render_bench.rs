//! Offline render measurements on the real Wave Link mic chain (Settings.json read-only) and a recorded take.
//!
//! ```text
//! cargo run --release --example render_bench -- [--take ../../_test/control-2-cm-raw.wav] [--runs 3]
//! ```
//!
//! Prints: the time of a whole-take run (wall seconds and × real time) with the stored chain and with each hosted
//! slot alone (the others bypassed), the cost of the IPC sample codec and of a chain reset, repeatability (max |diff|
//! between runs of the take, with another take in between) with and without the reset for several pre-roll lengths,
//! real-time-paced vs fast runs per slot, and whether a VST3 run right after its bypass was turned off matches a
//! settled one (and how long that first run takes).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use voice_check_bench_desktop_lib::audio::commands::mic_chain;
use voice_check_bench_desktop_lib::chain::SlotStatus;
use voice_check_bench_desktop_lib::host::PluginKind;
use voice_check_bench_desktop_lib::render::commands::{samples_from_le_bytes, samples_to_le_bytes};
use voice_check_bench_desktop_lib::render::{RenderSession, RunOptions, PREROLL_SAMPLES};

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn load_take(path: &PathBuf) -> Vec<f32> {
    let mut r = hound::WavReader::open(path).expect("open take");
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
    all.iter().step_by(ch).copied().collect()
}

fn max_diff(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b)
        .map(|(x, y)| (x - y).abs())
        .fold(0f32, f32::max)
}

/// First sample index where |a − b| > tol (None when they agree everywhere).
fn first_diff(a: &[f32], b: &[f32], tol: f32) -> Option<usize> {
    a.iter().zip(b).position(|(x, y)| (x - y).abs() > tol)
}

/// Median wall time of `runs` default runs (after one warm-up run).
fn time_runs(s: &mut RenderSession, take: &[f32], runs: usize) -> Duration {
    s.run(take).expect("warm-up run");
    let mut t: Vec<Duration> = (0..runs)
        .map(|_| {
            let t0 = Instant::now();
            s.run(take).expect("run");
            t0.elapsed()
        })
        .collect();
    t.sort();
    t[t.len() / 2]
}

fn other_take(take: &[f32]) -> Vec<f32> {
    let mut x = 7u32;
    take.iter()
        .rev()
        .map(|v| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let n = (x >> 8) as f32 / (1u32 << 24) as f32 - 0.5;
            (v * 4.0 + 0.05 * n).clamp(-1.0, 1.0)
        })
        .collect()
}

fn main() {
    let take_path = arg("--take").map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../_test/control-2-cm-raw.wav")
    });
    let runs: usize = arg("--runs").and_then(|v| v.parse().ok()).unwrap_or(3);
    let take = load_take(&take_path);
    let secs = take.len() as f64 / 48_000.0;
    println!(
        "take {} ({secs:.2} s, {} samples)",
        take_path.display(),
        take.len()
    );

    let (_source, specs) = mic_chain().expect("Wave Link mic chain");
    let t0 = Instant::now();
    let mut s = RenderSession::open(&specs).expect("open");
    println!("open: {:.0} ms", t0.elapsed().as_secs_f64() * 1e3);
    let stored: Vec<bool> = s.status().slots.iter().map(|x| x.info.bypassed).collect();
    let hosted: Vec<usize> = s
        .status()
        .slots
        .iter()
        .filter(|x| matches!(x.info.status, SlotStatus::Hosted { .. }))
        .map(|x| x.info.index)
        .collect();
    for x in s.status().slots {
        println!(
            "  slot {} {:30} bypassed {:5} latency {:5} {:?}",
            x.info.index, x.info.name, x.info.bypassed, x.info.latency_samples, x.info.status
        );
    }
    let restore = |s: &mut RenderSession| {
        for &k in &hosted {
            s.set_bypass(k, stored[k]).expect("bypass");
        }
    };

    // ---- Timing ----
    let pre = PREROLL_SAMPLES as f64 / 48_000.0;
    println!("\ntiming (median of {runs} runs, each with {pre:.1} s pre-roll):");
    let t = time_runs(&mut s, &take, runs).as_secs_f64();
    println!(
        "  stored chain (latency {:5}): {t:.3} s wall = {:.1}x real time",
        s.status().latency_samples,
        secs / t
    );
    for &k in &hosted {
        s.set_bypass(k, false).expect("bypass");
    }
    let t = time_runs(&mut s, &take, runs).as_secs_f64();
    println!(
        "  every hosted slot on (latency {:5}): {t:.3} s wall = {:.1}x real time",
        s.status().latency_samples,
        secs / t
    );
    for &solo in &hosted {
        for &k in &hosted {
            s.set_bypass(k, k != solo).expect("bypass");
        }
        let t = time_runs(&mut s, &take, runs).as_secs_f64();
        println!(
            "  alone {:30}: {t:.3} s wall = {:.1}x real time",
            s.slot(solo).unwrap().info.name,
            secs / t
        );
    }
    for &k in &hosted {
        s.set_bypass(k, true).expect("bypass");
    }
    let t = time_runs(&mut s, &take, runs).as_secs_f64();
    println!(
        "  everything bypassed          : {t:.3} s wall = {:.1}x real time",
        secs / t
    );
    restore(&mut s);
    let t0 = Instant::now();
    let bytes = samples_to_le_bytes(&take);
    let back = samples_from_le_bytes(&bytes).unwrap();
    println!(
        "  IPC codec (to + from bytes, {} MB): {:.1} ms",
        bytes.len() / 1_000_000,
        t0.elapsed().as_secs_f64() * 1e3
    );
    assert_eq!(back, take);

    let t0 = Instant::now();
    for _ in 0..10 {
        s.chain().reset().expect("reset");
    }
    println!(
        "  reset of every plugin: {:.1} ms",
        t0.elapsed().as_secs_f64() * 1e3 / 10.0
    );

    // ---- Repeatability: reset on/off × pre-roll ----
    let other = other_take(&take);
    println!(
        "
repeatability (stored chain; take, take, other take, take; max |diff| against the first):"
    );
    for (reset, preroll) in [
        (false, 0usize),
        (false, 48_000),
        (false, 96_000),
        (true, 0),
        (true, PREROLL_SAMPLES),
    ] {
        let o = RunOptions {
            reset,
            preroll_samples: preroll,
            pace: None,
        };
        let a = s.run_with(&take, &o).unwrap();
        let b = s.run_with(&take, &o).unwrap();
        s.run_with(&other, &o).unwrap();
        let c = s.run_with(&take, &o).unwrap();
        println!(
            "  reset {reset:5} pre-roll {:4.2} s: back to back {:e}, after other {:e} (first diff > 1e-6 at {:?})",
            preroll as f64 / 48_000.0,
            max_diff(&a, &b),
            max_diff(&a, &c),
            first_diff(&a, &c, 1e-6)
        );
    }

    // ---- Real-time paced vs fast, and right after a VST3 bypass change ----
    let piece = &take[..take.len().min(6 * 48_000)];
    let paced = RunOptions {
        pace: Some(Duration::from_millis(10)),
        ..RunOptions::default()
    };
    let fast = s.run(piece).unwrap();
    let slow = s.run_with(piece, &paced).unwrap();
    println!(
        "
6 s excerpt, default runs: real-time paced (10 ms per block) vs fast, max |diff|:
  stored chain {:e}",
        max_diff(&fast, &slow)
    );
    for &k in &hosted {
        let info = s.slot(k).unwrap().info;
        for &j in &hosted {
            s.set_bypass(j, j != k).expect("bypass");
        }
        let fast = s.run(piece).unwrap();
        let slow = s.run_with(piece, &paced).unwrap();
        let vst3 = matches!(
            info.status,
            SlotStatus::Hosted {
                kind: PluginKind::Vst3,
                ..
            }
        );
        let mut line = format!(
            "  alone {:30}: paced vs fast {:e}",
            info.name,
            max_diff(&fast, &slow)
        );
        if vst3 {
            // Bypass on, then off, then render at once: does that run already process like a later one?
            s.set_bypass(k, true).unwrap();
            s.run(piece).unwrap();
            s.set_bypass(k, false).unwrap();
            let t0 = Instant::now();
            let first = s.run(piece).unwrap();
            line += &format!(
                "; right after bypass off vs settled {:e} ({:.0} ms)",
                max_diff(&first, &fast),
                t0.elapsed().as_secs_f64() * 1e3
            );
        }
        println!("{line}");
    }
    restore(&mut s);
}
