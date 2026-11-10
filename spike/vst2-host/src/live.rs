// WASAPI (cpal) side of the spike: list devices, probe an input, and run mic -> ReaPlugs chain -> output.
// Output is silent unless --gain is given (default 0): every output sample is multiplied by the gain and clamped.
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, Data, Device, SampleFormat, StreamConfig};
use ringbuf::HeapRb;
use ringbuf::traits::{Consumer, Observer, Producer, Split};

use crate::chain::build_chain;
use crate::settings::Entry;
use crate::util::{Opts, db, pct};

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

fn dir_of(d: &Device) -> String {
    d.description().map(|x| format!("{:?}", x.direction())).unwrap_or_else(|_| "?".into())
}

pub fn devices() -> Result<()> {
    let host = cpal::default_host();
    println!("host: {:?}", host.id());
    println!("default input : {}", host.default_input_device().map(|d| d.to_string()).unwrap_or_default());
    println!("default output: {}", host.default_output_device().map(|d| d.to_string()).unwrap_or_default());
    for d in host.devices()? {
        println!("\n* {}  [{}]", d, dir_of(&d));
        if let Ok(c) = d.default_input_config() {
            println!("    input  default: {} ch {} Hz {:?} buffer {:?}", c.channels(), c.sample_rate(), c.sample_format(), c.buffer_size());
        }
        if let Ok(c) = d.default_output_config() {
            println!("    output default: {} ch {} Hz {:?} buffer {:?}", c.channels(), c.sample_rate(), c.sample_format(), c.buffer_size());
        }
    }
    Ok(())
}

/// Device whose name contains `needle` (case/punctuation-insensitive). For input, capture endpoints win over
/// render endpoints (a render endpoint opened as input is WASAPI loopback); `loopback` forces a render endpoint.
fn find(needle: &str, input: bool, loopback: bool) -> Result<Device> {
    let host = cpal::default_host();
    let n = norm(needle);
    let all: Vec<Device> = host.devices()?.filter(|d| norm(&d.to_string()).contains(&n)).collect();
    let is_capture = |d: &Device| d.description().map(|x| x.supports_input()).unwrap_or(false);
    let is_render = |d: &Device| d.description().map(|x| x.supports_output()).unwrap_or(false);
    let pick = if input && !loopback {
        all.iter().find(|d| is_capture(d) && !is_render(d)).or_else(|| all.iter().find(|d| d.supports_input()))
    } else if input {
        all.iter().find(|d| is_render(d))
    } else {
        all.iter().find(|d| is_render(d) && d.supports_output())
    };
    match pick {
        Some(d) => Ok(d.clone()),
        None => bail!(
            "no {} device matches {needle:?}; candidates: {}",
            if input { "input" } else { "output" },
            all.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(" | ")
        ),
    }
}

/// Interleaved device samples -> f32, any of the formats WASAPI shared mode hands out.
fn to_f32(data: &Data, out: &mut Vec<f32>) {
    out.clear();
    match data.sample_format() {
        SampleFormat::F32 => out.extend_from_slice(data.as_slice::<f32>().unwrap()),
        SampleFormat::I16 => out.extend(data.as_slice::<i16>().unwrap().iter().map(|&v| v as f32 / 32768.0)),
        SampleFormat::I32 => out.extend(data.as_slice::<i32>().unwrap().iter().map(|&v| v as f32 / 2147483648.0)),
        _ => {}
    }
}

// ---------------------------------------------------------------- risk 4: probe an input

pub fn probe(o: &Opts) -> Result<()> {
    let dev = find(o.get("in").context("--in NAME")?, true, o.has("loopback"))?;
    let secs = o.f32("seconds", 5.0);
    // A render endpoint opened as input is WASAPI loopback: its format is the output mix format.
    let cfg = if o.has("loopback") { dev.default_output_config() } else { dev.default_input_config() }.context("default config")?;
    println!("device : {}  [{}]", dev, dir_of(&dev));
    println!("format : {} ch, {} Hz, {:?}, buffer {:?}", cfg.channels(), cfg.sample_rate(), cfg.sample_format(), cfg.buffer_size());
    if let Ok(list) = dev.supported_input_configs() {
        for c in list {
            println!(
                "  supports: {} ch {}..{} Hz {:?} buffer {:?}",
                c.channels(),
                c.min_sample_rate(),
                c.max_sample_rate(),
                c.sample_format(),
                c.buffer_size()
            );
        }
    }
    let ch = cfg.channels() as usize;
    #[derive(Default)]
    struct P {
        sq: Vec<f64>,
        peak: Vec<f32>,
        frames: u64,
        calls: u64,
        min_f: usize,
        max_f: usize,
        lat: Vec<f64>,
        errors: Vec<String>,
    }
    let st = Arc::new(Mutex::new(P { sq: vec![0.0; ch], peak: vec![0.0; ch], min_f: usize::MAX, ..Default::default() }));
    let (s1, s2) = (st.clone(), st.clone());
    let mut buf = Vec::with_capacity(1 << 16);
    let t = Instant::now();
    let stream = dev
        .build_input_stream_raw(
            cfg.config(),
            cfg.sample_format(),
            move |data: &Data, info: &cpal::InputCallbackInfo| {
                to_f32(data, &mut buf);
                let ts = info.timestamp();
                let mut s = s1.lock().unwrap();
                let frames = buf.len() / ch;
                s.calls += 1;
                s.frames += frames as u64;
                s.min_f = s.min_f.min(frames);
                s.max_f = s.max_f.max(frames);
                s.lat.push(ts.callback.saturating_duration_since(ts.capture).as_secs_f64() * 1e3);
                for (k, v) in buf.iter().enumerate() {
                    let c = k % ch;
                    s.sq[c] += (*v as f64) * (*v as f64);
                    s.peak[c] = s.peak[c].max(v.abs());
                }
            },
            move |e| s2.lock().unwrap().errors.push(e.to_string()),
            Some(Duration::from_secs(5)),
        )
        .context("build_input_stream")?;
    println!("opened in {:.0} ms; stream.buffer_size() = {:?}", t.elapsed().as_secs_f64() * 1e3, stream.buffer_size());
    stream.play().context("play")?;
    std::thread::sleep(Duration::from_secs_f32(secs));
    drop(stream);
    let mut guard = st.lock().unwrap();
    let s = &mut *guard;
    let frames = s.frames.max(1) as f64;
    println!(
        "captured {} frames in {} callbacks ({:.2} s), frames/callback {}..{}, capture->callback median {:.2} ms",
        s.frames,
        s.calls,
        s.frames as f64 / cfg.sample_rate() as f64,
        if s.calls > 0 { s.min_f } else { 0 },
        s.max_f,
        pct(&mut s.lat, 50.0)
    );
    for c in 0..ch {
        println!("  ch{c}: RMS {:.1} dBFS, peak {:.1} dBFS", db((s.sq[c] / frames).sqrt()), db(s.peak[c] as f64));
    }
    if !s.errors.is_empty() {
        println!("stream errors: {:?}", s.errors);
    }
    Ok(())
}

// ---------------------------------------------------------------- risk 3: live chain

#[derive(Default)]
struct LiveStats {
    in_calls: u64,
    in_min: usize,
    in_max: usize,
    proc_us: Vec<f64>,
    proc_frames: Vec<f64>,
    in_lat_ms: Vec<f64>,
    out_calls: u64,
    out_min: usize,
    out_max: usize,
    out_lat_ms: Vec<f64>,
    underrun_frames: u64,
    underrun_calls: u64,
    dropped_frames: u64,
    fill: Vec<f64>,
    e2e_ms: Vec<f64>,
    /// (first input frame index, frames, capture instant ns) of recent input callbacks
    hist: VecDeque<(u64, u64, u128)>,
    raw_sq: f64,
    raw_n: u64,
    proc_sq: f64,
    errors: Vec<String>,
}

pub fn live(o: &Opts, entries: &[Entry]) -> Result<()> {
    let gain = o.f32("gain", 0.0);
    let secs = o.f32("seconds", 10.0);
    let feed = o.usize("feed", 2);
    let in_dev = find(o.get("in").context("--in NAME")?, true, false)?;
    let out_dev = find(o.get("out").context("--out NAME")?, false, false)?;
    let in_cfg = in_dev.default_input_config()?;
    let out_cfg = out_dev.default_output_config()?;
    let sr = in_cfg.sample_rate();
    let in_ch = in_cfg.channels() as usize;
    let out_ch = out_cfg.channels() as usize;
    let in_sel = o.usize("in-ch", 0).min(in_ch - 1);
    let buffer = match o.usize("buffer", 0) {
        0 => BufferSize::Default,
        n => BufferSize::Fixed(n as u32),
    };
    println!("input : {} [{} ch {} Hz {:?}], using channel {in_sel}", in_dev, in_ch, sr, in_cfg.sample_format());
    println!(
        "output: {} [{} ch, device default {} Hz {:?}; opened at {} Hz]",
        out_dev,
        out_ch,
        out_cfg.sample_rate(),
        out_cfg.sample_format(),
        sr
    );
    println!("gain {gain} ({}), buffer request {:?}", if gain == 0.0 { "SILENT" } else { "AUDIBLE" }, buffer);

    let max_block = 2048;
    let sets = crate::chain::parse_sets(o.get("set").unwrap_or(""))?;
    let mut chain = build_chain(entries, sr as f32, max_block, feed, o.get("only"), &sets)?;
    if o.has("bypass") {
        chain.plugins.clear();
    }
    let delay: i32 = chain.plugins.iter().map(|p| p.initial_delay()).sum();
    println!("chain: {} (sum of initialDelay {delay} samples = {:.2} ms)", chain.names().join(" -> "), delay as f64 / sr as f64 * 1e3);

    let rb = HeapRb::<f32>::new(sr as usize); // 1 s
    let (mut prod, mut cons) = rb.split();
    let st = Arc::new(Mutex::new(LiveStats { in_min: usize::MAX, out_min: usize::MAX, ..Default::default() }));
    let prefill_req = o.usize("prefill", 0);

    // input: device -> mono -> chain -> ring
    let s_in = st.clone();
    let s_err1 = st.clone();
    let mut ibuf = Vec::with_capacity(1 << 16);
    let mut mono = vec![0.0f32; 1 << 16];
    let mut in_index: u64 = 0;
    let in_config = StreamConfig { channels: in_ch as u16, sample_rate: sr, buffer_size: buffer };
    let in_stream = in_dev.build_input_stream_raw(
        in_config,
        in_cfg.sample_format(),
        move |data: &Data, info: &cpal::InputCallbackInfo| {
            to_f32(data, &mut ibuf);
            let frames = ibuf.len() / in_ch;
            if frames > mono.len() {
                mono.resize(frames, 0.0);
            }
            let m = &mut mono[..frames];
            let mut raw_sq = 0.0;
            for (k, v) in m.iter_mut().enumerate() {
                *v = ibuf[k * in_ch + in_sel];
                raw_sq += (*v as f64) * (*v as f64);
            }
            let t = Instant::now();
            chain.process(m);
            let us = t.elapsed().as_secs_f64() * 1e6;
            let pushed = prod.push_slice(m);
            let ts = info.timestamp();
            let mut s = s_in.lock().unwrap();
            s.in_calls += 1;
            s.in_min = s.in_min.min(frames);
            s.in_max = s.in_max.max(frames);
            s.proc_us.push(us);
            s.proc_frames.push(frames as f64);
            s.in_lat_ms.push(ts.callback.saturating_duration_since(ts.capture).as_secs_f64() * 1e3);
            s.dropped_frames += (frames - pushed) as u64;
            s.raw_sq += raw_sq;
            s.raw_n += frames as u64;
            s.proc_sq += m.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>();
            s.hist.push_back((in_index, frames as u64, ts.capture.as_nanos()));
            if s.hist.len() > 400 {
                s.hist.pop_front();
            }
            in_index += frames as u64;
        },
        move |e| s_err1.lock().unwrap().errors.push(format!("input: {e}")),
        Some(Duration::from_secs(5)),
    )?;
    let in_period = in_stream.buffer_size().unwrap_or(480) as usize;

    // output: ring -> gain (0 = silent) -> all channels
    let s_out = st.clone();
    let s_err2 = st.clone();
    let mut tmp = vec![0.0f32; 1 << 16];
    let mut popped: u64 = 0;
    let mut started = false;
    let out_config = StreamConfig { channels: out_ch as u16, sample_rate: sr, buffer_size: buffer };
    let out_fmt = out_cfg.sample_format();
    let prefill_cell = Arc::new(std::sync::atomic::AtomicUsize::new(prefill_req));
    let prefill_out = prefill_cell.clone();
    let out_stream = out_dev.build_output_stream_raw(
        out_config,
        out_fmt,
        move |data: &mut Data, info: &cpal::OutputCallbackInfo| {
            let frames = data.len() / out_ch;
            if frames > tmp.len() {
                tmp.resize(frames, 0.0);
            }
            let prefill = prefill_out.load(std::sync::atomic::Ordering::Relaxed);
            let avail = cons.occupied_len();
            if !started && avail >= prefill.max(1) {
                started = true;
            }
            let got = if started { cons.pop_slice(&mut tmp[..frames]) } else { 0 };
            tmp[got..frames].fill(0.0);
            let ts = info.timestamp();
            match data.sample_format() {
                SampleFormat::F32 => {
                    let d = data.as_slice_mut::<f32>().unwrap();
                    for f in 0..frames {
                        let v = (tmp[f] * gain).clamp(-1.0, 1.0);
                        d[f * out_ch..(f + 1) * out_ch].fill(v);
                    }
                }
                SampleFormat::I16 => {
                    let d = data.as_slice_mut::<i16>().unwrap();
                    for f in 0..frames {
                        let v = ((tmp[f] * gain).clamp(-1.0, 1.0) * 32767.0) as i16;
                        d[f * out_ch..(f + 1) * out_ch].fill(v);
                    }
                }
                _ => {}
            }
            let mut s = s_out.lock().unwrap();
            s.out_calls += 1;
            s.out_min = s.out_min.min(frames);
            s.out_max = s.out_max.max(frames);
            s.out_lat_ms.push(ts.playback.saturating_duration_since(ts.callback).as_secs_f64() * 1e3);
            s.fill.push(avail as f64);
            if started && got < frames {
                s.underrun_calls += 1;
                s.underrun_frames += (frames - got) as u64;
            }
            if got > 0 {
                // end-to-end: when the first popped frame was captured vs when it will be played
                let k = popped;
                if let Some(&(start, n, cap)) = s.hist.iter().find(|(start, n, _)| k >= *start && k < start + n) {
                    let _ = n;
                    let cap_k = cap + ((k - start) as u128 * 1_000_000_000 / sr as u128);
                    let play = ts.playback.as_nanos();
                    s.e2e_ms.push((play as f64 - cap_k as f64) / 1e6);
                }
                popped += got as u64;
            }
        },
        move |e| s_err2.lock().unwrap().errors.push(format!("output: {e}")),
        Some(Duration::from_secs(5)),
    )?;
    let out_period = out_stream.buffer_size().unwrap_or(480) as usize;
    if prefill_req == 0 {
        prefill_cell.store(in_period.max(out_period), std::sync::atomic::Ordering::Relaxed);
    }
    println!(
        "stream.buffer_size(): input {:?} frames, output {:?} frames; output starts when the ring holds {} frames",
        in_stream.buffer_size(),
        out_stream.buffer_size(),
        prefill_cell.load(std::sync::atomic::Ordering::Relaxed)
    );
    out_stream.play()?;
    in_stream.play()?;
    println!("running {secs} s ...");
    std::thread::sleep(Duration::from_secs_f32(secs));
    drop(in_stream);
    drop(out_stream);

    let mut guard = st.lock().unwrap();
    let s = &mut *guard;
    let ms = |f: f64| f / sr as f64 * 1e3;
    println!("\ninput  callbacks {}  frames/callback {}..{}", s.in_calls, s.in_min, s.in_max);
    println!("output callbacks {}  frames/callback {}..{}", s.out_calls, s.out_min, s.out_max);
    let mut per_frame: Vec<f64> = s.proc_us.iter().zip(&s.proc_frames).map(|(u, f)| u / f.max(1.0)).collect();
    let med_frames = pct(&mut s.proc_frames.clone(), 50.0);
    println!(
        "chain processing per input callback ({} frames = {:.2} ms of audio): median {:.1} us, p99 {:.1} us, max {:.1} us ({:.2}% / {:.2}% of the period)",
        med_frames,
        ms(med_frames),
        pct(&mut s.proc_us, 50.0),
        pct(&mut s.proc_us, 99.0),
        pct(&mut s.proc_us, 100.0),
        pct(&mut s.proc_us, 50.0) / (ms(med_frames) * 1e3) * 100.0,
        pct(&mut s.proc_us, 100.0) / (ms(med_frames) * 1e3) * 100.0
    );
    println!("  per frame: median {:.3} us", pct(&mut per_frame, 50.0));
    println!(
        "ring fill at output callbacks: median {:.0} frames ({:.2} ms), min {:.0}, max {:.0}",
        pct(&mut s.fill, 50.0),
        ms(pct(&mut s.fill, 50.0)),
        pct(&mut s.fill, 0.0),
        pct(&mut s.fill, 100.0)
    );
    println!(
        "underruns: {} callbacks / {} frames; dropped (ring full): {} frames",
        s.underrun_calls, s.underrun_frames, s.dropped_frames
    );
    println!(
        "input capture->callback: median {:.2} ms (max {:.2}); output callback->playback: median {:.2} ms (max {:.2})",
        pct(&mut s.in_lat_ms, 50.0),
        pct(&mut s.in_lat_ms, 100.0),
        pct(&mut s.out_lat_ms, 50.0),
        pct(&mut s.out_lat_ms, 100.0)
    );
    println!(
        "END-TO-END (capture of a frame -> its predicted playback): median {:.2} ms, min {:.2}, max {:.2} ({} samples); + plugin initialDelay {:.2} ms",
        pct(&mut s.e2e_ms, 50.0),
        pct(&mut s.e2e_ms, 0.0),
        pct(&mut s.e2e_ms, 100.0),
        s.e2e_ms.len(),
        delay as f64 / sr as f64 * 1e3
    );
    let n = s.raw_n.max(1) as f64;
    println!("levels: raw mic RMS {:.1} dBFS, processed RMS {:.1} dBFS (before gain {gain})", db((s.raw_sq / n).sqrt()), db((s.proc_sq / n).sqrt()));
    if !s.errors.is_empty() {
        println!("stream errors: {:?}", &s.errors[..s.errors.len().min(10)]);
    }
    Ok(())
}
