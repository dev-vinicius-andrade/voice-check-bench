// UI stream thread (SPEC `stream`): every 100 ms it drains the aligned raw/processed blocks the audio thread
// queued, adds meters and counters, and hands one StreamFrame to the sink (a Tauri channel in the app). It runs
// at normal priority; the audio thread never waits for it (a full ring only drops blocks and counts them).
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use rtrb::Consumer;

use super::frame::{rms_peak_db, StreamFrame};
use super::pipeline::StreamBlock;
use super::stats::Counters;
use crate::host::SAMPLE_RATE;

/// How often a frame is sent.
pub const STREAM_PERIOD: Duration = Duration::from_millis(100);
/// Blocks the audio → stream ring holds (1 s).
pub const STREAM_RING_BLOCKS: usize = 100;

/// Receives every frame, on the stream thread.
pub type FrameSink = Box<dyn FnMut(StreamFrame) + Send>;

/// Build a frame from the blocks of one period (pure; the stream thread and tests use it).
pub fn build_frame(blocks: &[StreamBlock], seq: u32, counters: &Counters) -> StreamFrame {
    let raw: Vec<f32> = blocks.iter().flat_map(|b| b.raw).collect();
    let processed: Vec<f32> = blocks.iter().flat_map(|b| b.processed).collect();
    let (raw_rms_db, raw_peak_db) = rms_peak_db(&raw);
    let (processed_rms_db, processed_peak_db) = rms_peak_db(&processed);
    let latency_samples = blocks.last().map_or(0, |b| b.latency);
    StreamFrame {
        seq,
        sample_rate: SAMPLE_RATE,
        latency_samples,
        settled: blocks.iter().all(|b| b.settled),
        latency_changed: blocks.iter().any(|b| b.latency != latency_samples),
        raw_rms_db,
        raw_peak_db,
        processed_rms_db,
        processed_peak_db,
        counters: counters.snapshot(),
        raw,
        processed,
    }
}

pub struct StreamThread {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl StreamThread {
    pub fn spawn(
        mut blocks: Consumer<StreamBlock>,
        counters: Arc<Counters>,
        mut sink: FrameSink,
    ) -> std::io::Result<StreamThread> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let handle = std::thread::Builder::new()
            .name("vcb-audio-stream".into())
            .spawn(move || {
                let start = Instant::now();
                let mut seq = 0u32;
                let mut period: Vec<StreamBlock> = Vec::with_capacity(STREAM_RING_BLOCKS);
                let mut tick = 1u32;
                while !flag.load(Ordering::Acquire) {
                    let due = start + STREAM_PERIOD * tick;
                    if let Some(wait) = due.checked_duration_since(Instant::now()) {
                        std::thread::sleep(wait);
                    }
                    tick += 1;
                    period.clear();
                    while let Ok(b) = blocks.pop() {
                        period.push(b);
                    }
                    if period.is_empty() {
                        continue;
                    }
                    sink(build_frame(&period, seq, &counters));
                    seq = seq.wrapping_add(1);
                }
            })?;
        Ok(StreamThread {
            stop,
            handle: Some(handle),
        })
    }

    /// Stop after the current period (≤ 100 ms) and wait for the thread.
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for StreamThread {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use rtrb::RingBuffer;

    use super::*;
    use crate::host::BLOCK;

    fn block(v: f32, latency: u32, settled: bool) -> StreamBlock {
        StreamBlock {
            raw: [v; BLOCK],
            processed: [v / 2.0; BLOCK],
            latency,
            settled,
        }
    }

    #[test]
    fn frame_concatenates_blocks_with_meters() {
        let c = Counters::default();
        let f = build_frame(&[block(0.5, 960, true), block(-0.5, 960, true)], 3, &c);
        assert_eq!(f.seq, 3);
        assert_eq!(f.raw.len(), 2 * BLOCK);
        assert_eq!(f.processed[BLOCK], -0.25);
        assert_eq!(f.latency_samples, 960);
        assert!(f.settled && !f.latency_changed);
        assert!((f.raw_rms_db - -6.0206).abs() < 1e-3);
        assert!((f.processed_peak_db - -12.0412).abs() < 1e-3);
    }

    #[test]
    fn frame_flags_settling_and_latency_moves() {
        let c = Counters::default();
        let f = build_frame(&[block(0.1, 480, false), block(0.1, 960, true)], 0, &c);
        assert!(!f.settled, "one unsettled block marks the frame");
        assert!(f.latency_changed);
        assert_eq!(f.latency_samples, 960, "latency of the last block");
    }

    #[test]
    fn thread_sends_one_frame_per_period_and_stops() {
        let (mut tx, rx) = RingBuffer::new(STREAM_RING_BLOCKS);
        let (send, recv) = mpsc::channel();
        let mut t = StreamThread::spawn(
            rx,
            Arc::new(Counters::default()),
            Box::new(move |f| send.send(f).unwrap()),
        )
        .unwrap();
        for _ in 0..10 {
            tx.push(block(0.25, 0, true)).unwrap();
        }
        let f = recv.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(f.seq, 0);
        assert_eq!(f.raw.len(), 10 * BLOCK);
        tx.push(block(0.25, 0, true)).unwrap();
        let g = recv.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!((g.seq, g.raw.len()), (1, BLOCK));
        t.stop();
        assert!(
            recv.recv_timeout(Duration::from_millis(300)).is_err(),
            "no frame after stop"
        );
    }
}
