// One UI stream message: ~100 ms of aligned raw and processed audio, meters and counters, as a little-endian
// binary frame (sent raw over a Tauri channel, read in JS as an ArrayBuffer; decoder: src/desktop/audioFrame.ts).
//
// Layout v1 (every field 4 bytes, so the two f32 arrays stay 4-byte aligned):
//   0 version u32 (1)      4 seq u32             8 sampleRate u32      12 samples u32 (n, per side)
//  16 latencySamples u32  20 flags u32 (bit 0 settled, bit 1 latencyChanged)
//  24 rawRmsDb f32        28 rawPeakDb f32      32 processedRmsDb f32  36 processedPeakDb f32
//  40 blocks u32          44 inputOverruns u32  48 outputUnderruns u32 52 monitorDropped u32
//  56 streamDropped u32   60 streamErrors u32   64 processP50Us f32    68 processP99Us f32
//  72 processMaxUs f32    76 reserved u32 (0)
//  80 raw f32 × n, then processed f32 × n
use super::stats::CountersSnapshot;

pub const FRAME_VERSION: u32 = 1;
pub const HEADER_BYTES: usize = 80;
/// Meter floor (dBFS), the web app's LEVEL_FLOOR (src/audio/AudioEngine.ts).
pub const LEVEL_FLOOR_DB: f32 = -120.0;

const FLAG_SETTLED: u32 = 1;
const FLAG_LATENCY_CHANGED: u32 = 2;

#[derive(Debug, Clone, PartialEq)]
pub struct StreamFrame {
    pub seq: u32,
    pub sample_rate: u32,
    /// Delay applied to `raw` so it lines up with `processed` (the chain's full latency at the last block).
    pub latency_samples: u32,
    /// Every block of the frame was processed with the chain settled.
    pub settled: bool,
    /// The alignment latency changed inside this frame (a state load moved it).
    pub latency_changed: bool,
    pub raw_rms_db: f32,
    pub raw_peak_db: f32,
    pub processed_rms_db: f32,
    pub processed_peak_db: f32,
    pub counters: CountersSnapshot,
    pub raw: Vec<f32>,
    pub processed: Vec<f32>,
}

/// RMS and peak of `x` in dBFS, floored at [`LEVEL_FLOOR_DB`].
pub fn rms_peak_db(x: &[f32]) -> (f32, f32) {
    let db = |a: f64| {
        if a > 0.0 {
            ((20.0 * a.log10()) as f32).max(LEVEL_FLOOR_DB)
        } else {
            LEVEL_FLOOR_DB
        }
    };
    if x.is_empty() {
        return (LEVEL_FLOOR_DB, LEVEL_FLOOR_DB);
    }
    let sq: f64 = x.iter().map(|v| (*v as f64) * (*v as f64)).sum();
    let peak = x.iter().fold(0f64, |m, v| m.max(v.abs() as f64));
    (db((sq / x.len() as f64).sqrt()), db(peak))
}

fn sat32(v: u64) -> u32 {
    v.min(u32::MAX as u64) as u32
}

impl StreamFrame {
    pub fn encode(&self) -> Vec<u8> {
        let n = self.raw.len().min(self.processed.len());
        let mut b = Vec::with_capacity(HEADER_BYTES + 8 * n);
        let flags = if self.settled { FLAG_SETTLED } else { 0 }
            | if self.latency_changed {
                FLAG_LATENCY_CHANGED
            } else {
                0
            };
        let c = &self.counters;
        for u in [
            FRAME_VERSION,
            self.seq,
            self.sample_rate,
            n as u32,
            self.latency_samples,
            flags,
        ] {
            b.extend_from_slice(&u.to_le_bytes());
        }
        for f in [
            self.raw_rms_db,
            self.raw_peak_db,
            self.processed_rms_db,
            self.processed_peak_db,
        ] {
            b.extend_from_slice(&f.to_le_bytes());
        }
        for u in [
            c.blocks,
            c.input_overruns,
            c.output_underruns,
            c.monitor_dropped,
            c.stream_dropped,
            c.stream_errors,
        ] {
            b.extend_from_slice(&sat32(u).to_le_bytes());
        }
        for f in [c.process_p50_us, c.process_p99_us, c.process_max_us] {
            b.extend_from_slice(&(f as f32).to_le_bytes());
        }
        b.extend_from_slice(&0u32.to_le_bytes());
        debug_assert_eq!(b.len(), HEADER_BYTES);
        for v in self.raw[..n].iter().chain(&self.processed[..n]) {
            b.extend_from_slice(&v.to_le_bytes());
        }
        b
    }

    /// Inverse of [`StreamFrame::encode`] (tests and tools). `None` on a wrong version or size.
    pub fn decode(b: &[u8]) -> Option<StreamFrame> {
        let u = |at: usize| -> Option<u32> {
            Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
        };
        let f = |at: usize| -> Option<f32> {
            Some(f32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
        };
        if u(0)? != FRAME_VERSION {
            return None;
        }
        let n = u(12)? as usize;
        if b.len() != HEADER_BYTES + 8 * n {
            return None;
        }
        let floats =
            |from: usize| -> Option<Vec<f32>> { (0..n).map(|k| f(from + 4 * k)).collect() };
        let flags = u(20)?;
        Some(StreamFrame {
            seq: u(4)?,
            sample_rate: u(8)?,
            latency_samples: u(16)?,
            settled: flags & FLAG_SETTLED != 0,
            latency_changed: flags & FLAG_LATENCY_CHANGED != 0,
            raw_rms_db: f(24)?,
            raw_peak_db: f(28)?,
            processed_rms_db: f(32)?,
            processed_peak_db: f(36)?,
            counters: CountersSnapshot {
                blocks: u(40)? as u64,
                input_overruns: u(44)? as u64,
                output_underruns: u(48)? as u64,
                monitor_dropped: u(52)? as u64,
                stream_dropped: u(56)? as u64,
                stream_errors: u(60)? as u64,
                process_p50_us: f(64)? as f64,
                process_p99_us: f(68)? as f64,
                process_max_us: f(72)? as f64,
                block_us: super::stats::block_us() as f64,
            },
            raw: floats(HEADER_BYTES)?,
            processed: floats(HEADER_BYTES + 4 * n)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frame described by `src/desktop/audioFrame.fixture.json` (shared with the TypeScript decoder test).
    fn fixture_frame() -> StreamFrame {
        StreamFrame {
            seq: 7,
            sample_rate: 48_000,
            latency_samples: 4576,
            settled: true,
            latency_changed: false,
            raw_rms_db: -30.5,
            raw_peak_db: -12.25,
            processed_rms_db: -20.0,
            processed_peak_db: -6.5,
            counters: CountersSnapshot {
                blocks: 700,
                input_overruns: 1,
                output_underruns: 2,
                monitor_dropped: 3,
                stream_dropped: 4,
                stream_errors: 5,
                process_p50_us: 45.0,
                process_p99_us: 600.0,
                process_max_us: 1250.0,
                block_us: 10_000.0,
            },
            raw: vec![0.5, -0.25, 0.0, 1.0],
            processed: vec![-1.0, 0.125, 0.75, -0.5],
        }
    }

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    #[test]
    fn encodes_the_shared_fixture() {
        let text = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src/desktop/audioFrame.fixture.json"
        ));
        let fixture: serde_json::Value = serde_json::from_str(text).unwrap();
        let bytes = fixture_frame().encode();
        assert_eq!(bytes.len(), HEADER_BYTES + 8 * 4);
        assert_eq!(hex(&bytes), fixture["hex"].as_str().unwrap());
    }

    #[test]
    fn round_trips() {
        let f = fixture_frame();
        assert_eq!(StreamFrame::decode(&f.encode()), Some(f));
        let mut bad = fixture_frame().encode();
        bad[0] = 9;
        assert_eq!(StreamFrame::decode(&bad), None, "unknown version");
        let short = &fixture_frame().encode()[..HEADER_BYTES + 3];
        assert_eq!(StreamFrame::decode(short), None, "truncated");
    }

    #[test]
    fn meters() {
        assert_eq!(rms_peak_db(&[]), (LEVEL_FLOOR_DB, LEVEL_FLOOR_DB));
        assert_eq!(rms_peak_db(&[0.0; 10]), (LEVEL_FLOOR_DB, LEVEL_FLOOR_DB));
        let (rms, peak) = rms_peak_db(&[0.5, -0.5, 0.5, -0.5]);
        assert!((rms - -6.0206).abs() < 1e-3 && (peak - -6.0206).abs() < 1e-3);
        let (rms, peak) = rms_peak_db(&[1.0, 0.0]);
        assert!((rms - -3.0103).abs() < 1e-3 && peak == 0.0);
    }
}
