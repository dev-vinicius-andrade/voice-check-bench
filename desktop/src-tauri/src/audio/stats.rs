// Engine counters: written by the audio callbacks with relaxed atomics (no locks, no allocation), read by any
// thread as a snapshot.
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use serde::Serialize;

use crate::host::{BLOCK, SAMPLE_RATE};

/// Fixed-width histogram of durations in microseconds. `record` is wait-free; percentiles are nearest-rank, read
/// by scanning the buckets (control side).
pub struct Histogram {
    buckets: Box<[AtomicU32]>,
    width_us: u32,
    max_us: AtomicU32,
    count: AtomicU64,
}

impl Histogram {
    /// `buckets` buckets of `width_us` µs each; the last one also takes everything longer.
    pub fn new(buckets: usize, width_us: u32) -> Self {
        Self {
            buckets: (0..buckets.max(1)).map(|_| AtomicU32::new(0)).collect(),
            width_us: width_us.max(1),
            max_us: AtomicU32::new(0),
            count: AtomicU64::new(0),
        }
    }

    pub fn record(&self, us: u32) {
        let i = ((us / self.width_us) as usize).min(self.buckets.len() - 1);
        self.buckets[i].fetch_add(1, Ordering::Relaxed);
        self.max_us.fetch_max(us, Ordering::Relaxed);
        self.count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }

    pub fn max_us(&self) -> u32 {
        self.max_us.load(Ordering::Relaxed)
    }

    /// Nearest-rank percentile `p` (0..=100) in µs, at bucket resolution (the bucket's lower edge; the overflow
    /// bucket reports the maximum). 0 when empty.
    pub fn percentile(&self, p: f64) -> f64 {
        let counts: Vec<u64> = self
            .buckets
            .iter()
            .map(|b| b.load(Ordering::Relaxed) as u64)
            .collect();
        let total: u64 = counts.iter().sum();
        if total == 0 {
            return 0.0;
        }
        let rank = ((p.clamp(0.0, 100.0) / 100.0) * total as f64)
            .ceil()
            .max(1.0) as u64;
        let mut seen = 0;
        for (i, c) in counts.iter().enumerate() {
            seen += c;
            if seen >= rank {
                return if i == counts.len() - 1 {
                    self.max_us() as f64
                } else {
                    (i as u32 * self.width_us) as f64
                };
            }
        }
        self.max_us() as f64
    }
}

/// Everything the engine counts. Shared (`Arc`) between the callbacks, the stream thread and the control side.
pub struct Counters {
    /// 480-sample blocks processed.
    pub blocks: AtomicU64,
    /// Capture overruns WASAPI reported (data discontinuity): audio lost before it reached the engine.
    pub input_overruns: AtomicU64,
    /// Output callbacks that found fewer samples than the device asked for (silence was played instead), plus
    /// render Xruns the backend reports.
    pub output_underruns: AtomicU64,
    /// Processed blocks dropped because the output had not taken the previous ones (monitor ring full).
    pub monitor_dropped: AtomicU64,
    /// Blocks the UI stream could not take (its ring was full).
    pub stream_dropped: AtomicU64,
    /// Other errors reported by the WASAPI streams (device lost, …).
    pub stream_errors: AtomicU64,
    /// Time to process one block (chain, delays, monitor), µs.
    pub process_us: Histogram,
}

impl Default for Counters {
    fn default() -> Self {
        Self {
            blocks: AtomicU64::new(0),
            input_overruns: AtomicU64::new(0),
            output_underruns: AtomicU64::new(0),
            monitor_dropped: AtomicU64::new(0),
            stream_dropped: AtomicU64::new(0),
            stream_errors: AtomicU64::new(0),
            // 1 µs resolution up to two blocks (20 ms); longer goes to the last bucket.
            process_us: Histogram::new(2 * block_us() as usize, 1),
        }
    }
}

/// Duration of one block in µs (10 000).
pub const fn block_us() -> u32 {
    (BLOCK as u64 * 1_000_000 / SAMPLE_RATE as u64) as u32
}

pub(crate) fn bump(c: &AtomicU64) {
    c.fetch_add(1, Ordering::Relaxed);
}

/// A copy of the counters at one moment.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountersSnapshot {
    pub blocks: u64,
    pub input_overruns: u64,
    pub output_underruns: u64,
    pub monitor_dropped: u64,
    pub stream_dropped: u64,
    pub stream_errors: u64,
    pub process_p50_us: f64,
    pub process_p99_us: f64,
    pub process_max_us: f64,
    /// Duration of one block (the real-time budget), µs.
    pub block_us: f64,
}

impl Counters {
    pub fn snapshot(&self) -> CountersSnapshot {
        let get = |c: &AtomicU64| c.load(Ordering::Relaxed);
        CountersSnapshot {
            blocks: get(&self.blocks),
            input_overruns: get(&self.input_overruns),
            output_underruns: get(&self.output_underruns),
            monitor_dropped: get(&self.monitor_dropped),
            stream_dropped: get(&self.stream_dropped),
            stream_errors: get(&self.stream_errors),
            process_p50_us: self.process_us.percentile(50.0),
            process_p99_us: self.process_us.percentile(99.0),
            process_max_us: self.process_us.max_us() as f64,
            block_us: block_us() as f64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_rank_percentiles() {
        let h = Histogram::new(1000, 1);
        for us in (1..=100).rev() {
            h.record(us);
        }
        assert_eq!(h.count(), 100);
        assert_eq!(h.percentile(50.0), 50.0);
        assert_eq!(h.percentile(99.0), 99.0);
        assert_eq!(h.percentile(100.0), 100.0);
        assert_eq!(h.percentile(0.0), 1.0, "p0 is the smallest sample");
        assert_eq!(h.max_us(), 100);
    }

    #[test]
    fn skewed_distribution() {
        let h = Histogram::new(20_000, 1);
        for _ in 0..990 {
            h.record(40);
        }
        for _ in 0..10 {
            h.record(900);
        }
        assert_eq!(h.percentile(50.0), 40.0);
        assert_eq!(h.percentile(99.0), 40.0, "990 of 1000 samples are 40 µs");
        assert_eq!(h.percentile(99.5), 900.0);
        assert_eq!(h.max_us(), 900);
    }

    #[test]
    fn bucket_width_and_overflow() {
        let h = Histogram::new(10, 100);
        h.record(250); // bucket 2
        h.record(5_000); // overflow
        assert_eq!(
            h.percentile(50.0),
            200.0,
            "lower edge of the 200..300 bucket"
        );
        assert_eq!(h.percentile(100.0), 5_000.0, "overflow reports the maximum");
    }

    #[test]
    fn empty_histogram_is_zero() {
        let h = Histogram::new(10, 1);
        assert_eq!(h.percentile(99.0), 0.0);
    }

    #[test]
    fn snapshot_reads_every_counter() {
        let c = Counters::default();
        bump(&c.blocks);
        bump(&c.blocks);
        bump(&c.output_underruns);
        c.process_us.record(120);
        let s = c.snapshot();
        assert_eq!(s.blocks, 2);
        assert_eq!(s.output_underruns, 1);
        assert_eq!(s.input_overruns, 0);
        assert_eq!(s.process_max_us, 120.0);
        assert_eq!(s.block_us, 10_000.0);
        let json = serde_json::to_value(s).unwrap();
        assert!(json.get("processP99Us").is_some() && json.get("inputOverruns").is_some());
    }
}
