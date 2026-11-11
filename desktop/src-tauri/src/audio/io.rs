// The two cpal callbacks. Input (capture thread): device samples → channel 0 → 480-sample blocks → Pipeline →
// monitor ring. Output (render thread): monitor ring → every channel. Both own preallocated buffers only: no
// allocation, no locks, no waiting.
use std::sync::Arc;

use cpal::{Data, SampleFormat};
use rtrb::{Consumer, Producer};

use super::pipeline::{BlockChain, Pipeline};
use super::stats::{bump, Counters};
use crate::host::BLOCK;

/// Monitor ring capacity (blocks).
pub const MONITOR_RING_BLOCKS: usize = 8;
/// The output starts (and restarts after an underrun) once the ring holds this many samples. One block of margin
/// over the minimum: a 10 min soak with one block had an underrun from callback jitter; this adds 10 ms of monitor
/// latency.
pub const PREFILL: usize = 2 * BLOCK;

pub fn is_supported(format: SampleFormat) -> bool {
    matches!(
        format,
        SampleFormat::F32 | SampleFormat::I16 | SampleFormat::I32 | SampleFormat::F64
    )
}

pub struct InputSide<C: BlockChain> {
    pipeline: Pipeline<C>,
    channels: usize,
    block: Vec<f32>,
    fill: usize,
    out: Vec<f32>,
    monitor: Producer<f32>,
    counters: Arc<Counters>,
}

impl<C: BlockChain> InputSide<C> {
    pub fn new(
        pipeline: Pipeline<C>,
        channels: usize,
        monitor: Producer<f32>,
        counters: Arc<Counters>,
    ) -> Self {
        Self {
            pipeline,
            channels: channels.max(1),
            block: vec![0.0; BLOCK],
            fill: 0,
            out: vec![0.0; BLOCK],
            monitor,
            counters,
        }
    }

    pub fn on_data(&mut self, data: &Data) {
        match data.sample_format() {
            SampleFormat::F32 => self.feed(data.as_slice::<f32>(), |v| v),
            SampleFormat::I16 => self.feed(data.as_slice::<i16>(), |v| v as f32 / 32_768.0),
            SampleFormat::I32 => self.feed(data.as_slice::<i32>(), |v| v as f32 / 2_147_483_648.0),
            SampleFormat::F64 => self.feed(data.as_slice::<f64>(), |v| v as f32),
            _ => {}
        }
    }

    /// Channel 0 of each frame into the block; every full block goes through the pipeline.
    fn feed<T: Copy>(&mut self, samples: Option<&[T]>, conv: impl Fn(T) -> f32) {
        let Some(samples) = samples else { return };
        for frame in samples.chunks_exact(self.channels) {
            self.block[self.fill] = conv(frame[0]);
            self.fill += 1;
            if self.fill == BLOCK {
                self.fill = 0;
                self.pipeline.process_block(&self.block, &mut self.out);
                if self.monitor.push_entire_slice(&self.out).is_err() {
                    bump(&self.counters.monitor_dropped);
                }
            }
        }
    }
}

pub struct OutputSide {
    ring: Consumer<f32>,
    channels: usize,
    tmp: Vec<f32>,
    started: bool,
    counters: Arc<Counters>,
}

impl OutputSide {
    pub fn new(ring: Consumer<f32>, channels: usize, counters: Arc<Counters>) -> Self {
        Self {
            ring,
            channels: channels.max(1),
            tmp: vec![0.0; 4096],
            started: false,
            counters,
        }
    }

    pub fn on_data(&mut self, data: &mut Data) {
        match data.sample_format() {
            SampleFormat::F32 => self.render(data.as_slice_mut::<f32>(), |v| v),
            SampleFormat::I16 => self.render(data.as_slice_mut::<i16>(), |v| (v * 32_767.0) as i16),
            SampleFormat::I32 => self.render(data.as_slice_mut::<i32>(), |v| {
                (v as f64 * 2_147_483_647.0) as i32
            }),
            SampleFormat::F64 => self.render(data.as_slice_mut::<f64>(), |v| v as f64),
            _ => {}
        }
    }

    fn render<T: Copy>(&mut self, out: Option<&mut [T]>, conv: impl Fn(f32) -> T) {
        let Some(out) = out else { return };
        let mut short = false;
        for chunk in out.chunks_mut(self.tmp.len() * self.channels) {
            let frames = chunk.len() / self.channels;
            if !self.started && self.ring.slots() >= PREFILL {
                self.started = true;
            }
            let got = if self.started {
                let (filled, _) = self.ring.pop_partial_slice(&mut self.tmp[..frames]);
                filled.len()
            } else {
                0
            };
            self.tmp[got..frames].fill(0.0);
            if self.started && got < frames {
                short = true;
                self.started = false;
            }
            for (f, v) in chunk.chunks_exact_mut(self.channels).zip(&self.tmp) {
                f.fill(conv(*v));
            }
        }
        if short {
            bump(&self.counters.output_underruns);
        }
    }
}

#[cfg(test)]
mod tests {
    use rtrb::RingBuffer;

    use super::*;

    #[test]
    fn output_waits_for_prefill_then_counts_underruns() {
        let (mut tx, rx) = RingBuffer::new(BLOCK * MONITOR_RING_BLOCKS);
        let counters = Arc::new(Counters::default());
        let mut out = OutputSide::new(rx, 2, counters.clone());
        let mut dev = vec![1.0f32; 2 * BLOCK];

        out.render(Some(&mut dev), |v| v);
        assert!(dev.iter().all(|v| *v == 0.0), "silence before prefill");
        assert_eq!(
            counters.snapshot().output_underruns,
            0,
            "prefill is not an underrun"
        );

        let block: Vec<f32> = (0..BLOCK).map(|k| k as f32 / BLOCK as f32).collect();
        tx.push_entire_slice(&block).unwrap();
        out.render(Some(&mut dev), |v| v);
        assert!(
            dev.iter().all(|v| *v == 0.0),
            "one block is below the prefill"
        );
        tx.push_entire_slice(&block).unwrap();
        out.render(Some(&mut dev), |v| v);
        assert_eq!(dev[2 * 7], block[7]);
        assert_eq!(dev[2 * 7 + 1], block[7], "mono duplicated to every channel");
        assert_eq!(counters.snapshot().output_underruns, 0);

        out.render(Some(&mut dev), |v| v);
        out.render(Some(&mut dev), |v| v);
        assert_eq!(
            counters.snapshot().output_underruns,
            1,
            "empty ring after start"
        );
        assert!(dev.iter().all(|v| *v == 0.0));
    }

    #[test]
    fn i16_output_conversion() {
        let (mut tx, rx) = RingBuffer::new(BLOCK * 2);
        let mut out = OutputSide::new(rx, 1, Arc::new(Counters::default()));
        tx.push_entire_slice(&[0.5; 2 * BLOCK]).unwrap();
        let mut dev = vec![0i16; BLOCK];
        out.render(Some(&mut dev), |v| (v * 32_767.0) as i16);
        assert!(dev.iter().all(|v| *v == 16_383));
    }
}
