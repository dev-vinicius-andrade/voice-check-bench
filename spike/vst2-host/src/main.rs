// vst2-host: throwaway feasibility spike. Hosts the ReaPlugs VST2 plugins Wave Link uses, round-trips their state
// against a COPY of Wave Link's Settings.json, processes audio offline and live. See FINDINGS.md.
mod chain;
mod fxb;
mod live;
mod periods;
mod settings;
mod util;
mod vst;

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result, bail};

use crate::chain::{apply_state, build_chain, export_state, parse_sets};
use crate::fxb::Body;
use crate::util::{Opts, db, pct, stats};
use crate::vst::{Plugin, fourcc, host_opcode_report};

const HELP: &str = "vst2-host <command> [options]
  state    [--settings PATH] [--mutate \"ReaComp:11=3.9810717;ReaEQ:4=0.5\"]
           load each ReaPlugs state from the Settings COPY, print params, export and compare bytes,
           apply mutations and write out/Settings.modified.json (a copy; the real file is never touched)
  offline  [--wav PATH] [--block 480] [--feed 2] [--only ReaEQ,ReaComp] [--out out/processed.wav]
  devices  list WASAPI input/output devices
  periods  IAudioClient3 engine periods per endpoint (how low a shared-mode period could go)
  delay    measured processing delay of each stored plugin and of the chain
  probe    --in NAME [--seconds 5] [--loopback]   open an input (or a render device as loopback) and report RMS
  live     --in NAME --out NAME [--gain 0] [--seconds 10] [--buffer FRAMES] [--prefill FRAMES] [--feed 2]
           [--only ReaEQ,ReaComp] [--bypass]   mic -> ReaPlugs chain -> output; gain 0 = silent (default)";

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn settings_path(o: &Opts) -> PathBuf {
    o.get("settings").map(PathBuf::from).unwrap_or_else(|| crate_dir().join("out").join("Settings.copy.json"))
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().cloned().unwrap_or_default();
    let o = Opts::parse(args.get(1..).unwrap_or(&[]));
    match cmd.as_str() {
        "state" => cmd_state(&o),
        "offline" => cmd_offline(&o),
        "delay" => cmd_delay(&o),
        "devices" => live::devices(),
        "periods" => periods::periods(),
        "probe" => live::probe(&o),
        "live" => {
            let sc = settings::load(&settings_path(&o))?;
            live::live(&o, &sc.entries)
        }
        _ => {
            println!("{HELP}");
            Ok(())
        }
    }
}

// ---------------------------------------------------------------- risk 1: state round trip

fn cmd_state(o: &Opts) -> Result<()> {
    let path = settings_path(o);
    if path.to_string_lossy().contains("Elgato.WaveLink_") {
        bail!("refusing to use the real Wave Link file; pass a copy");
    }
    let sc = settings::load(&path)?;
    println!("Settings copy: {}\nMic input: {}", path.display(), sc.input_key);
    println!(
        "Effects on the mic input (file order): {}",
        sc.entries.iter().map(|e| format!("{}{}", e.name, if e.bypass { " [bypassed]" } else { "" })).collect::<Vec<_>>().join(" -> ")
    );
    let mutations = parse_sets(o.get("mutate").unwrap_or("ReaComp:11=3.9810717"))?;
    let mut modified = sc.raw.clone();
    let mut wrote_any = false;

    for e in sc.entries.iter().filter(|e| e.is_reaplug()) {
        let blob = e.blob()?;
        let stored = fxb::parse(&blob)?;
        println!("\n==================== {} ({})", e.name, e.file_path);
        let mut p = Plugin::load(Path::new(&e.file_path), e.short())?;
        p.setup(48_000.0, 512);
        let kind = match &stored.body {
            Body::Chunk(c) => format!("FBCh chunk {} bytes", c.len()),
            Body::Bank(ps) => format!("FxBk {} program(s) x {} params", ps.len(), ps.first().map_or(0, |p| p.params.len())),
        };
        println!(
            "stored : {} bytes, {kind}, byteSize {}, version {}, fxID {}, fxVersion {}, numPrograms {}, currentProgram {}",
            blob.len(),
            stored.byte_size,
            stored.version,
            fourcc(stored.fx_id),
            stored.fx_version,
            stored.num_programs,
            stored.current_program
        );
        println!(
            "plugin : \"{}\" vendor \"{}\" uniqueID {} version {} vendorVersion {} numPrograms {} numParams {} in {} out {} flags 0x{:x} (programChunks {}) initialDelay {}",
            p.effect_name(),
            p.vendor(),
            fourcc(p.unique_id()),
            p.version(),
            p.vendor_version(),
            p.num_programs(),
            p.num_params(),
            p.num_inputs(),
            p.num_outputs(),
            p.flags(),
            p.uses_chunks(),
            p.initial_delay()
        );
        let default_state = export_state(&mut p);
        println!("default (fresh instance) export: {} bytes, equal to stored: {}", default_state.len(), default_state == blob);

        let t = Instant::now();
        apply_state(&mut p, &blob)?;
        println!("loaded stored state in {:.2} ms", t.elapsed().as_secs_f64() * 1e3);
        let stored_vals = match &stored.body {
            Body::Bank(ps) => Some(ps[0].params.clone()),
            Body::Chunk(_) => None,
        };
        println!("  idx  name                         stored        getParameter  display");
        for k in 0..p.num_params() {
            let name = p.param_name(k);
            let disp = format!("{} {}", p.param_display(k), p.param_label(k));
            let sv = stored_vals.as_ref().and_then(|v| v.get(k as usize)).map_or("-".to_string(), |v| format!("{v:.6}"));
            println!("  {k:3}  {name:28} {sv:>12}  {:>12.6}  {}", p.get_param(k), disp.trim());
        }

        let exported = export_state(&mut p);
        let diffs = fxb::diff(&blob, &exported);
        if diffs.is_empty() {
            println!("ROUND TRIP: host export is BYTE-IDENTICAL to Wave Link's stored blob ({} bytes)", blob.len());
        } else {
            println!("ROUND TRIP: {} difference(s):", diffs.len());
            for d in diffs.iter().take(20) {
                println!("  {d}");
            }
            describe_bank_diff(&blob, &exported);
            // Second generation: is the host's own export stable?
            let mut q = Plugin::load(Path::new(&e.file_path), e.short())?;
            q.setup(48_000.0, 512);
            apply_state(&mut q, &exported)?;
            let again = export_state(&mut q);
            println!("  host export re-loaded into a fresh instance and exported again: identical = {}", again == exported);
            let again2 = export_state(&mut p);
            println!("  same instance exported twice in a row: identical = {}", again2 == exported);
            let dir = crate_dir().join("out");
            std::fs::write(dir.join(format!("state-{}-stored.bin", e.short())), &blob)?;
            std::fs::write(dir.join(format!("state-{}-host.bin", e.short())), &exported)?;
            std::fs::write(dir.join(format!("state-{}-host2.bin", e.short())), &again)?;
            let (d1, rms) = audio_diff(&e.file_path, e.short(), &blob, &exported)?;
            let (d2, _) = audio_diff(&e.file_path, e.short(), &blob, &again)?;
            println!(
                "  AUDIO: 4 s of deterministic test noise+tone, output RMS {:.1} dBFS; stored state vs host export: max |diff| {d1:e}; vs 2nd-generation export: {d2:e}",
                db(rms)
            );
        }

        // Mutations on this plugin
        let mine: Vec<_> = mutations.iter().filter(|m| m.0.eq_ignore_ascii_case(e.short())).collect();
        if !mine.is_empty() {
            for (_, idx, v) in &mine {
                let before = p.param_display(*idx);
                p.set_param(*idx, *v);
                println!(
                    "MUTATE {} param {} \"{}\": {} -> setParameter({v}) -> getParameter {} display \"{} {}\"",
                    e.short(),
                    idx,
                    p.param_name(*idx),
                    before,
                    p.get_param(*idx),
                    p.param_display(*idx),
                    p.param_label(*idx)
                );
            }
            let mutated = export_state(&mut p);
            println!("  mutated export vs stored:");
            for d in fxb::diff(&blob, &mutated) {
                println!("    {d}");
            }
            describe_bank_diff(&blob, &mutated);
            modified = settings::replace_state(&modified, &e.parameter_state, &mutated)?;
            wrote_any = true;
        }
    }

    if wrote_any {
        let out = crate_dir().join("out").join("Settings.modified.json");
        std::fs::write(&out, &modified)?;
        let changed_bytes = sc.raw.len() as isize - modified.len() as isize;
        println!("\nwrote {} (length delta {} bytes vs copy)", out.display(), -changed_bytes);
    }
    println!("\nhost callback opcodes asked by plugins: {}", host_opcode_report());
    Ok(())
}

/// Max absolute sample difference between two fresh instances loaded with state `a` and state `b`,
/// fed the same deterministic noise + tone (left output).
fn audio_diff(path: &str, label: &str, a: &[u8], b: &[u8]) -> Result<(f32, f64)> {
    let n = 48_000 * 4;
    let mut seed: u32 = 12345;
    let sig: Vec<f32> = (0..n)
        .map(|k| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = (seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0;
            0.05 * noise + 0.1 * (k as f32 * 2.0 * std::f32::consts::PI * 440.0 / 48_000.0).sin() * if (k / 12_000) % 2 == 0 { 1.0 } else { 0.0 }
        })
        .collect();
    let mut outs = vec![];
    for blob in [a, b] {
        let mut p = Plugin::load(Path::new(path), label)?;
        p.setup(48_000.0, 480);
        apply_state(&mut p, blob)?;
        p.resume();
        let mut out = vec![0.0f32; n];
        for (i, o) in sig.chunks(480).zip(out.chunks_mut(480)) {
            p.process_mono(i, o, 2);
        }
        outs.push(out);
    }
    let rms = stats(&outs[0]).0;
    Ok((outs[0].iter().zip(&outs[1]).map(|(x, y)| (x - y).abs()).fold(0.0, f32::max), rms))
}

/// Measured processing delay of each plugin (stored state) and of the whole chain: a 1 kHz Hann burst is
/// processed and the lag of maximum cross-correlation between input and output is reported.
fn cmd_delay(o: &Opts) -> Result<()> {
    let sc = settings::load(&settings_path(o))?;
    let sr = 48_000usize;
    let n = sr;
    let at = 2000usize;
    let len = 480usize;
    let mut sig = vec![0.0f32; n];
    for k in 0..len {
        let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * k as f32 / len as f32).cos();
        sig[at + k] = 0.5 * w * (2.0 * std::f32::consts::PI * 1000.0 * k as f32 / sr as f32).sin();
    }
    let lag_of = |y: &[f32]| -> (usize, f32) {
        let mut best = (0usize, 0.0f32);
        for lag in 0..8192usize {
            let mut acc = 0.0f32;
            for k in at..at + len {
                if k + lag < y.len() {
                    acc += sig[k] * y[k + lag];
                }
            }
            if acc.abs() > best.1.abs() {
                best = (lag, acc);
            }
        }
        best
    };
    let active: Vec<String> = sc.entries.iter().filter(|e| e.is_reaplug() && !e.bypass).map(|e| e.short().to_string()).collect();
    let mut runs: Vec<String> = active.clone();
    runs.push(active.join(","));
    for only in runs {
        let mut chain = build_chain(&sc.entries, sr as f32, 480, 2, Some(&only), &[])?;
        let declared: i32 = chain.plugins.iter().map(|p| p.initial_delay()).sum();
        let mut y = sig.clone();
        chain.process(&mut y);
        let (lag, _) = lag_of(&y);
        println!(
            "{:32} declared initialDelay {:5} samples ({:6.2} ms)   measured lag {:5} samples ({:6.2} ms)",
            chain.names().join(" -> "),
            declared,
            declared as f64 / sr as f64 * 1e3,
            lag,
            lag as f64 / sr as f64 * 1e3
        );
    }
    Ok(())
}

/// For FxBk banks: translate differing bytes into parameter indices with both values.
fn describe_bank_diff(a: &[u8], b: &[u8]) {
    let (Ok(fa), Ok(fb)) = (fxb::parse(a), fxb::parse(b)) else { return };
    if let (Body::Bank(pa), Body::Bank(pb)) = (&fa.body, &fb.body) {
        for (k, (x, y)) in pa[0].params.iter().zip(&pb[0].params).enumerate() {
            if x.to_bits() != y.to_bits() {
                println!("    param {k}: stored {x} (0x{:08x}) host {y} (0x{:08x})", x.to_bits(), y.to_bits());
            }
        }
        if pa[0].name != pb[0].name {
            println!("    program name: stored {:?} host {:?}", String::from_utf8_lossy(&pa[0].name), String::from_utf8_lossy(&pb[0].name));
        }
    }
}

// ---------------------------------------------------------------- risk 2: offline processing

fn cmd_offline(o: &Opts) -> Result<()> {
    let sc = settings::load(&settings_path(o))?;
    let wav = o.get("wav").map(PathBuf::from).unwrap_or_else(|| crate_dir().join("../../_test/control-2-cm-raw.wav"));
    let block = o.usize("block", 480);
    let feed = o.usize("feed", 2);
    let mut r = hound::WavReader::open(&wav).with_context(|| format!("open {}", wav.display()))?;
    let spec = r.spec();
    let ch = spec.channels as usize;
    let all: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().collect::<Result<_, _>>()?,
        hound::SampleFormat::Int => {
            let scale = (1u64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().map(|s| s.map(|v| v as f32 / scale)).collect::<Result<_, _>>()?
        }
    };
    let input: Vec<f32> = all.iter().step_by(ch).copied().collect();
    let sr = spec.sample_rate as f32;
    println!(
        "input {}: {} ch, {} Hz, {} bit {:?}, {:.2} s (channel 0 used)",
        wav.file_name().unwrap().to_string_lossy(),
        ch,
        spec.sample_rate,
        spec.bits_per_sample,
        spec.sample_format,
        input.len() as f32 / sr
    );
    let sets = parse_sets(o.get("set").unwrap_or(""))?;
    let mut chain = build_chain(&sc.entries, sr, block, feed, o.get("only"), &sets)?;
    println!("chain (Wave Link order): {}   block {block}, mono fed to {feed} input(s), left output kept", chain.names().join(" -> "));
    for p in &chain.plugins {
        println!("  {}: numInputs {} numOutputs {} initialDelay {} samples", p.label, p.num_inputs(), p.num_outputs(), p.initial_delay());
    }

    let n = input.len();
    let np = chain.plugins.len();
    let mut stages = vec![input.clone()];
    stages.extend((0..np).map(|_| vec![0.0f32; n]));
    let mut per_plugin_ns: Vec<Vec<f64>> = vec![vec![]; np];
    let mut total_ns: Vec<f64> = vec![];
    let mut start = 0;
    while start < n {
        let end = (start + block).min(n);
        let t0 = Instant::now();
        for (k, p) in chain.plugins.iter_mut().enumerate() {
            let t = Instant::now();
            let (a, b) = stages.split_at_mut(k + 1);
            p.process_mono(&a[k][start..end], &mut b[0][start..end], feed);
            per_plugin_ns[k].push(t.elapsed().as_nanos() as f64);
        }
        total_ns.push(t0.elapsed().as_nanos() as f64);
        start = end;
    }
    let names = chain.names();
    // 20 ms window levels: 10th percentile ~ noise floor between words; share of windows below -70 dBFS ~ gated
    let floor = |x: &[f32]| -> (f64, f64) {
        let mut w: Vec<f64> = x.chunks(960).map(|c| db(stats(c).0).max(-200.0)).collect();
        let below = w.iter().filter(|v| **v < -70.0).count() as f64 / w.len().max(1) as f64;
        (pct(&mut w, 10.0), below)
    };
    println!("\n  stage              RMS dBFS   peak dBFS   exact-zero   p10 of 20ms windows   windows < -70 dBFS");
    for (k, st) in stages.iter().enumerate() {
        let s = stats(st);
        let f = floor(st);
        let label = if k == 0 { "raw input".to_string() } else { format!("after {}", names[k - 1]) };
        println!(
            "  {:18} {:8.1}   {:8.1}    {:6.2}%      {:8.1} dBFS        {:6.1}%",
            label,
            db(s.0),
            db(s.1),
            s.2 * 100.0,
            f.0,
            f.1 * 100.0
        );
    }
    let block_us = block as f64 / sr as f64 * 1e6;
    println!("\nprocessing time per {block}-frame block ({:.0} us of audio):", block_us);
    for (k, v) in per_plugin_ns.iter_mut().enumerate() {
        println!("  {:10} median {:7.1} us  p99 {:7.1} us  max {:7.1} us", names[k], pct(v, 50.0) / 1e3, pct(v, 99.0) / 1e3, pct(v, 100.0) / 1e3);
    }
    let med = pct(&mut total_ns, 50.0) / 1e3;
    let max = pct(&mut total_ns, 100.0) / 1e3;
    println!(
        "  {:10} median {:7.1} us  p99 {:7.1} us  max {:7.1} us  -> {:.2}% / {:.2}% of real time (median / max)",
        "CHAIN",
        med,
        pct(&mut total_ns, 99.0) / 1e3,
        max,
        med / block_us * 100.0,
        max / block_us * 100.0
    );

    let out = o.get("out").map(PathBuf::from).unwrap_or_else(|| crate_dir().join("out").join("processed.wav"));
    let mut w = hound::WavWriter::create(
        &out,
        hound::WavSpec { channels: 1, sample_rate: spec.sample_rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float },
    )?;
    for v in &stages[np] {
        w.write_sample(*v)?;
    }
    w.finalize()?;
    println!("\nwrote {}", out.display());
    println!("host callback opcodes asked by plugins: {}", host_opcode_report());
    drop(chain);
    Ok(())
}
