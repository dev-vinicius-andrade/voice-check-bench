//! Offline processing of a mono WAV through an instantiated plugin, plus level analysis.

use std::time::Instant;

use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;

use vst3::ComWrapper;

use crate::com::ParamChanges;
use crate::module::pump_messages;
use crate::plugin::{tr, Plugin};

pub fn read_mono(path: &str) -> Result<(Vec<f32>, u32), String> {
    let mut r = hound::WavReader::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let spec = r.spec();
    if spec.channels != 1 {
        return Err(format!("expected mono, got {} channels", spec.channels));
    }
    let s: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().map(|x| x.map(|v| v as f32 / scale)).collect::<Result<_, _>>().map_err(|e| e.to_string())?
        }
        hound::SampleFormat::Float => r.samples::<f32>().collect::<Result<_, _>>().map_err(|e| e.to_string())?,
    };
    Ok((s, spec.sample_rate))
}

pub fn write_mono_f32(path: &str, s: &[f32], sr: u32) -> Result<(), String> {
    let spec = hound::WavSpec { channels: 1, sample_rate: sr, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
    let mut w = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for v in s {
        w.write_sample(*v).map_err(|e| e.to_string())?;
    }
    w.finalize().map_err(|e| e.to_string())
}

pub struct ProcessReport {
    pub output: Vec<f32>,
    pub latency: u32,
    pub tail: u32,
    pub channels: i32,
    pub block_times_us: Vec<f64>,
    pub log: Vec<String>,
}

fn arrangement_channels(a: SpeakerArrangement) -> i32 {
    a.count_ones() as i32
}

/// setBusArrangements (mono, else stereo) → activateBus → setupProcessing → setActive → setProcessing → process loop.
pub struct Opts {
    pub stereo: bool,
    pub context: bool,
    /// Pump the Win32 message queue (JUCE message thread) for this long after setProcessing(true),
    /// and once per block while processing.
    pub warmup_ms: u64,
}

pub fn process(p: &Plugin, input: &[f32], sr: f64, block: usize, offline: bool, params: &[(u32, f64)], opts: &Opts) -> Result<ProcessReport, String> {
    let changes = ComWrapper::new(ParamChanges::new(params));
    let mut log = vec![];
    let comp = &p.component;
    let proc_ = &p.processor;
    let n_in = unsafe { comp.getBusCount(MediaTypes_::kAudio as MediaType, BusDirections_::kInput as BusDirection) };
    let n_out = unsafe { comp.getBusCount(MediaTypes_::kAudio as MediaType, BusDirections_::kOutput as BusDirection) };

    let current = |dir: BusDirections, n: i32| -> Vec<SpeakerArrangement> {
        (0..n)
            .map(|i| {
                let mut a = 0;
                unsafe { proc_.getBusArrangement(dir as BusDirection, i, &mut a) };
                a
            })
            .collect()
    };
    let mut channels = 0;
    let layouts: &[(&str, SpeakerArrangement)] =
        if opts.stereo { &[("stereo", SpeakerArr::kStereo)] } else { &[("mono", SpeakerArr::kMono), ("stereo", SpeakerArr::kStereo)] };
    for &(label, arr) in layouts {
        let mut ins = current(BusDirections_::kInput, n_in);
        let mut outs = current(BusDirections_::kOutput, n_out);
        if n_in > 0 {
            ins[0] = arr;
        }
        if n_out > 0 {
            outs[0] = arr;
        }
        let r = unsafe { proc_.setBusArrangements(ins.as_mut_ptr(), n_in, outs.as_mut_ptr(), n_out) };
        let got_in = current(BusDirections_::kInput, n_in);
        let got_out = current(BusDirections_::kOutput, n_out);
        log.push(format!("setBusArrangements({label}) -> {}; now in={got_in:X?} out={got_out:X?}", tr(r)));
        if r == kResultOk && got_in.first() == Some(&arr) && got_out.first() == Some(&arr) {
            channels = arrangement_channels(arr);
            break;
        }
    }
    if channels == 0 {
        let got = current(BusDirections_::kOutput, n_out);
        channels = got.first().map(|a| arrangement_channels(*a)).unwrap_or(2).max(1);
        log.push(format!("falling back to the plugin's own main arrangement: {channels} ch"));
    }
    for i in 0..n_in {
        let r = unsafe { comp.activateBus(MediaTypes_::kAudio as MediaType, BusDirections_::kInput as BusDirection, i, (i == 0) as TBool) };
        log.push(format!("activateBus(in {i}, {}) -> {}", i == 0, tr(r)));
    }
    for i in 0..n_out {
        let r = unsafe { comp.activateBus(MediaTypes_::kAudio as MediaType, BusDirections_::kOutput as BusDirection, i, (i == 0) as TBool) };
        log.push(format!("activateBus(out {i}, {}) -> {}", i == 0, tr(r)));
    }
    let can32 = unsafe { proc_.canProcessSampleSize(SymbolicSampleSizes_::kSample32 as int32) };
    log.push(format!("canProcessSampleSize(32) -> {}", tr(can32)));
    let mode = if offline { ProcessModes_::kOffline } else { ProcessModes_::kRealtime };
    let mut setup = ProcessSetup {
        processMode: mode as int32,
        symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
        maxSamplesPerBlock: block as int32,
        sampleRate: sr,
    };
    let r = unsafe { proc_.setupProcessing(&mut setup) };
    log.push(format!("setupProcessing(sr={sr}, block={block}, mode={}) -> {}", if offline { "offline" } else { "realtime" }, tr(r)));
    if r != kResultOk {
        return Err(format!("setupProcessing failed: {}", tr(r)));
    }
    let r = unsafe { comp.setActive(1) };
    log.push(format!("setActive(true) -> {}", tr(r)));
    if r != kResultOk {
        return Err(format!("setActive failed: {}", tr(r)));
    }
    let latency = unsafe { proc_.getLatencySamples() };
    let tail = unsafe { proc_.getTailSamples() };
    log.push(format!("getLatencySamples -> {latency}; getTailSamples -> {tail}"));
    let r = unsafe { proc_.setProcessing(1) };
    log.push(format!("setProcessing(true) -> {}", tr(r)));
    if opts.warmup_ms > 0 {
        let t0 = Instant::now();
        let mut n = 0;
        while t0.elapsed().as_millis() < opts.warmup_ms as u128 {
            n += pump_messages();
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        log.push(format!("warm-up: pumped {n} window messages over {} ms", opts.warmup_ms));
    }

    // Buffers for every audio bus (aux buses get silent buffers).
    let ch = channels as usize;
    let bus_ch = |dir: BusDirections, n: i32| -> Vec<usize> {
        current(dir, n).iter().enumerate().map(|(i, a)| if i == 0 { ch } else { arrangement_channels(*a) as usize }).collect()
    };
    let in_ch = bus_ch(BusDirections_::kInput, n_in);
    let out_ch = bus_ch(BusDirections_::kOutput, n_out);
    let mut in_bufs: Vec<Vec<Vec<f32>>> = in_ch.iter().map(|c| vec![vec![0f32; block]; *c]).collect();
    let mut out_bufs: Vec<Vec<Vec<f32>>> = out_ch.iter().map(|c| vec![vec![0f32; block]; *c]).collect();

    let total = input.len() + latency as usize + block;
    let mut output = Vec::with_capacity(total);
    let mut times = vec![];
    let mut pos = 0usize;
    let mut first_err = None;
    while pos < total {
        for (b, bus) in in_bufs.iter_mut().enumerate() {
            for chan in bus.iter_mut() {
                for (k, v) in chan.iter_mut().enumerate() {
                    *v = if b == 0 { input.get(pos + k).copied().unwrap_or(0.0) } else { 0.0 };
                }
            }
        }
        for bus in out_bufs.iter_mut() {
            for chan in bus.iter_mut() {
                chan.fill(0.0);
            }
        }
        let mut in_ptrs: Vec<Vec<*mut f32>> = in_bufs.iter_mut().map(|b| b.iter_mut().map(|c| c.as_mut_ptr()).collect()).collect();
        let mut out_ptrs: Vec<Vec<*mut f32>> = out_bufs.iter_mut().map(|b| b.iter_mut().map(|c| c.as_mut_ptr()).collect()).collect();
        let mut ins: Vec<AudioBusBuffers> = in_ptrs
            .iter_mut()
            .map(|p| AudioBusBuffers { numChannels: p.len() as i32, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: p.as_mut_ptr() } })
            .collect();
        let mut outs: Vec<AudioBusBuffers> = out_ptrs
            .iter_mut()
            .map(|p| AudioBusBuffers { numChannels: p.len() as i32, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: p.as_mut_ptr() } })
            .collect();
        #[allow(unused_mut)]
        let mut data = ProcessData {
            processMode: mode as int32,
            symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
            numSamples: block as int32,
            numInputs: n_in,
            numOutputs: n_out,
            inputs: ins.as_mut_ptr(),
            outputs: outs.as_mut_ptr(),
            // Parameter changes (e.g. --param) are delivered once, in the first block, at sample offset 0.
            inputParameterChanges: if pos == 0 && !params.is_empty() {
                changes.as_com_ref::<IParameterChanges>().unwrap().as_ptr()
            } else {
                std::ptr::null_mut()
            },
            outputParameterChanges: std::ptr::null_mut(),
            inputEvents: std::ptr::null_mut(),
            outputEvents: std::ptr::null_mut(),
            processContext: std::ptr::null_mut(),
        };
        let mut ctx: ProcessContext = unsafe { std::mem::zeroed() };
        if opts.context {
            ctx.state = (ProcessContext_::StatesAndFlags_::kPlaying
                | ProcessContext_::StatesAndFlags_::kTempoValid
                | ProcessContext_::StatesAndFlags_::kTimeSigValid
                | ProcessContext_::StatesAndFlags_::kSystemTimeValid) as u32;
            ctx.sampleRate = sr;
            ctx.projectTimeSamples = pos as i64;
            ctx.continousTimeSamples = pos as i64;
            ctx.tempo = 120.0;
            ctx.timeSigNumerator = 4;
            ctx.timeSigDenominator = 4;
            data.processContext = &mut ctx;
        }
        let t = Instant::now();
        let r = unsafe { proc_.process(&mut data) };
        times.push(t.elapsed().as_secs_f64() * 1e6);
        if r != kResultOk && first_err.is_none() {
            first_err = Some(format!("process() -> {} at sample {pos}", tr(r)));
        }
        if let Some(o) = out_bufs.first() {
            output.extend_from_slice(&o[0]);
            if ch > 1 && pos == block * 50 {
                let same = o[0].iter().zip(o[1].iter()).all(|(a, b)| a == b);
                log.push(format!("block 50: output L == R: {same}"));
            }
        }
        pos += block;
        if opts.warmup_ms > 0 {
            pump_messages();
        }
    }
    if let Some(e) = first_err {
        log.push(e);
    }
    let r = unsafe { proc_.setProcessing(0) };
    log.push(format!("setProcessing(false) -> {}", tr(r)));
    let r = unsafe { comp.setActive(0) };
    log.push(format!("setActive(false) -> {}", tr(r)));
    Ok(ProcessReport { output, latency, tail, channels, block_times_us: times, log })
}

pub fn db(x: f64) -> f64 {
    if x <= 1e-12 { -240.0 } else { 20.0 * x.log10() }
}

pub fn rms(s: &[f32]) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / s.len() as f64).sqrt()
}

pub fn peak(s: &[f32]) -> f64 {
    s.iter().fold(0f64, |m, v| m.max(v.abs() as f64))
}

/// dB RMS of consecutive frames.
pub fn frame_levels(s: &[f32], frame: usize) -> Vec<f64> {
    s.chunks(frame).filter(|c| c.len() == frame).map(|c| db(rms(c))).collect()
}

pub fn percentile(v: &[f64], p: f64) -> f64 {
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    if s.is_empty() {
        return f64::NAN;
    }
    let idx = ((p / 100.0) * (s.len() - 1) as f64).round() as usize;
    s[idx]
}
