// Pipeline tests with a fake chain of pure delays: compensation keeps the latency constant and raw/processed
// aligned for every bypass combination; queued commands apply between blocks; counters count.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use rtrb::RingBuffer;

use super::*;

/// A slot of the fake chain: a pure delay with a gain. `own_bypass` mimics Elgato Noise Removal: the slot then
/// passes audio through undelayed although its full latency stays.
struct FakeSlot {
    full: u32,
    gain: f32,
    bypassed: Arc<AtomicBool>,
    own_bypass: Arc<AtomicBool>,
    line: DelayLine,
}

/// (slot bypassed, own bypass) of a fake slot.
type Switches = (Arc<AtomicBool>, Arc<AtomicBool>);

struct FakeChain {
    slots: Vec<FakeSlot>,
    tmp: Vec<f32>,
}

impl FakeChain {
    /// (full latency, gain) per slot; returns the chain and each slot's (bypassed, own_bypass) switches.
    fn new(spec: &[(u32, f32)]) -> (Self, Vec<Switches>) {
        let mut switches = vec![];
        let slots = spec
            .iter()
            .map(|&(full, gain)| {
                let s = FakeSlot {
                    full,
                    gain,
                    bypassed: Arc::new(AtomicBool::new(false)),
                    own_bypass: Arc::new(AtomicBool::new(false)),
                    line: DelayLine::new(8192),
                };
                switches.push((s.bypassed.clone(), s.own_bypass.clone()));
                s
            })
            .collect();
        (
            Self {
                slots,
                tmp: vec![0.0; BLOCK],
            },
            switches,
        )
    }
}

impl BlockChain for FakeChain {
    fn process(&mut self, input: &[f32], output: &mut [f32]) -> BlockLatency {
        output.copy_from_slice(input);
        let mut lat = BlockLatency::default();
        for s in &mut self.slots {
            lat.full += s.full;
            if s.bypassed.load(Ordering::Relaxed) {
                continue;
            }
            let delay = if s.own_bypass.load(Ordering::Relaxed) {
                0
            } else {
                s.full
            };
            lat.active += delay;
            s.line.process(output, &mut self.tmp, delay as usize);
            for (o, v) in output.iter_mut().zip(&self.tmp) {
                *o = v * s.gain;
            }
        }
        lat
    }

    fn is_settled(&self) -> bool {
        true
    }
}

/// Deterministic white noise in -0.5..0.5.
fn noise(n: usize, seed: u32) -> Vec<f32> {
    let mut x = seed;
    (0..n)
        .map(|_| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (x >> 8) as f32 / (1u32 << 24) as f32 - 0.5
        })
        .collect()
}

/// Lag in -max..=max with the highest cross-correlation of `a` and `b` (b[i + lag] against a[i]).
pub(crate) fn best_lag(a: &[f32], b: &[f32], max: i64) -> i64 {
    let n = a.len() as i64;
    (-max..=max)
        .map(|lag| {
            let s: f64 = (0..n)
                .filter(|i| (0..n).contains(&(i + lag)))
                .map(|i| a[i as usize] as f64 * b[(i + lag) as usize] as f64)
                .sum();
            (lag, s)
        })
        .max_by(|x, y| x.1.partial_cmp(&y.1).unwrap())
        .map_or(0, |b| b.0)
}

struct Rig<C: BlockChain> {
    pipeline: Pipeline<C>,
    commands: Producer<RtCommand>,
    stream: Consumer<StreamBlock>,
    counters: Arc<Counters>,
}

fn rig<C: BlockChain>(chain: C, stream_cap: usize, monitor: Monitor, gain: f32) -> Rig<C> {
    let (ctx, crx) = RingBuffer::new(COMMAND_QUEUE);
    let (stx, srx) = RingBuffer::new(stream_cap);
    let counters = Arc::new(Counters::default());
    Rig {
        pipeline: Pipeline::new(chain, crx, stx, counters.clone(), monitor, gain),
        commands: ctx,
        stream: srx,
        counters,
    }
}

#[test]
fn constant_latency_and_alignment_for_every_bypass_combination() {
    // ReaFIR-like 4096, a gain-only slot, Noise-Removal-like 480 (own bypass switchable), another delay.
    let spec = [(4096, 0.9), (0, 0.5), (480, 0.8), (64, 1.25)];
    let full: u32 = spec.iter().map(|s| s.0).sum();
    let (chain, sw) = FakeChain::new(&spec);
    let mut r = rig(chain, 64, Monitor::Processed, 1.0);
    let signal = noise(BLOCK * 400, 7);
    let mut pos = 0;
    let mut out = vec![0.0; BLOCK];
    // 4 slot bypasses + the NR-like own bypass = 32 combinations.
    for combo in 0u32..32 {
        for (k, (bypassed, _)) in sw.iter().enumerate() {
            bypassed.store(combo & (1 << k) != 0, Ordering::Relaxed);
        }
        sw[2].1.store(combo & 16 != 0, Ordering::Relaxed);
        let gain: f32 = spec
            .iter()
            .enumerate()
            .filter(|(k, _)| combo & (1 << k) == 0)
            .map(|(_, s)| s.1)
            .product();
        let (mut raw, mut processed) = (vec![], vec![]);
        // 12 blocks of warm-up (> 4096 + 480 + 64 samples), then 6 measured blocks.
        for b in 0..18 {
            let input = &signal[pos..pos + BLOCK];
            pos = (pos + BLOCK) % (signal.len() - BLOCK);
            r.pipeline.process_block(input, &mut out);
            let blk = r.stream.pop().expect("one stream block per block");
            assert_eq!(blk.latency, full, "combo {combo:05b}: constant latency");
            if b >= 12 {
                raw.extend_from_slice(&blk.raw);
                processed.extend_from_slice(&blk.processed);
                assert_eq!(out, blk.processed, "monitor plays the processed block");
            }
        }
        for (a, b) in raw.iter().zip(&processed) {
            assert!(
                (a * gain - b).abs() < 1e-6,
                "combo {combo:05b}: processed = raw x {gain} sample by sample"
            );
        }
        assert_eq!(best_lag(&raw, &processed, 600), 0, "combo {combo:05b}");
    }
    assert_eq!(r.counters.snapshot().blocks, 32 * 18);
    assert_eq!(r.counters.snapshot().stream_dropped, 0);
}

/// A chain that inverts the signal, so processed and raw differ.
struct Invert;

impl BlockChain for Invert {
    fn process(&mut self, input: &[f32], output: &mut [f32]) -> BlockLatency {
        for (o, v) in output.iter_mut().zip(input) {
            *o = -v;
        }
        BlockLatency::default()
    }

    fn is_settled(&self) -> bool {
        true
    }
}

#[test]
fn queued_commands_apply_between_blocks() {
    let mut r = rig(Invert, 64, Monitor::Processed, 1.0);
    let input = noise(BLOCK, 3);
    let mut out = vec![0.0; BLOCK];

    r.pipeline.process_block(&input, &mut out);
    assert!(out.iter().zip(&input).all(|(o, v)| *o == -v));

    // Several commands queued while a block runs: all apply before the next block, the last one wins.
    r.commands.push(RtCommand::Gain(0.25)).unwrap();
    r.commands.push(RtCommand::Monitor(Monitor::Off)).unwrap();
    r.commands.push(RtCommand::Monitor(Monitor::Raw)).unwrap();
    r.commands.push(RtCommand::Gain(0.5)).unwrap();
    assert_eq!(
        r.pipeline.monitor(),
        Monitor::Processed,
        "nothing applies before the block"
    );
    r.pipeline.process_block(&input, &mut out);
    assert_eq!(r.pipeline.monitor(), Monitor::Raw);
    assert_eq!(r.pipeline.gain(), 0.5);
    assert!(
        out.iter().zip(&input).all(|(o, v)| *o == v * 0.5),
        "the whole block uses the new settings"
    );

    r.commands.push(RtCommand::Gain(100.0)).unwrap();
    r.commands.push(RtCommand::Monitor(Monitor::Off)).unwrap();
    r.pipeline.process_block(&input, &mut out);
    assert!(
        out.iter().all(|v| *v == 0.0),
        "Off is exact silence at any gain"
    );
}

#[test]
fn monitor_output_is_clamped() {
    let mut r = rig(Invert, 64, Monitor::Raw, db_to_gain(40.0));
    let input = noise(BLOCK, 5);
    let mut out = vec![0.0; BLOCK];
    r.pipeline.process_block(&input, &mut out);
    assert!(out.iter().all(|v| v.abs() <= 1.0));
    assert!(out.iter().any(|v| v.abs() == 1.0));
}

#[test]
fn full_stream_ring_counts_drops_and_keeps_processing() {
    let mut r = rig(Invert, 2, Monitor::Off, 1.0);
    let input = noise(BLOCK, 9);
    let mut out = vec![0.0; BLOCK];
    for _ in 0..5 {
        r.pipeline.process_block(&input, &mut out);
    }
    let s = r.counters.snapshot();
    assert_eq!(s.blocks, 5);
    assert_eq!(s.stream_dropped, 3);
    assert!(s.process_max_us < 10_000.0);
    assert_eq!(r.stream.slots(), 2);
}

#[test]
fn default_gain_is_minus_10_db() {
    let g = db_to_gain(super::super::DEFAULT_GAIN_DB);
    assert!((g - 0.316_227_8).abs() < 1e-6);
}
