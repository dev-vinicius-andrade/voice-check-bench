//! Audio engine (SPEC "Desktop app (v2.0)" `audio` and `stream`, PLAN task 39): raw mic in → Wave Link chain →
//! monitor out at 48 kHz in 480-sample blocks, mono, with a delay-compensated chain and an aligned raw/processed
//! stream to the UI.
//!
//! # Threads (who owns what)
//!
//! 1. **Capture callback** (cpal/WASAPI input thread) owns [`io::InputSide`]: it takes channel 0, cuts it into
//!    480-sample blocks and runs [`pipeline::Pipeline`] on each, which owns the `ChainProcessor`, both delay lines
//!    and the producers of the monitor ring and the stream ring. Before every block it drains the command queue
//!    (monitor mode, gain). Real-time: no allocation, no locks, no waiting.
//! 2. **Render callback** (cpal/WASAPI output thread) owns [`io::OutputSide`]: it pops the monitor ring into every
//!    output channel, waits for one block of prefill at start and after an underrun, and counts underruns.
//! 3. **Stream thread** ([`stream::StreamThread`]) pops the aligned blocks every 100 ms and sends one
//!    [`frame::StreamFrame`] (raw, processed, meters, counters) to the sink: a Tauri channel in the app.
//! 4. **Host thread** (`host::thread`): every plugin call that is not real-time safe (`set_param`, `set_bypass`,
//!    `load_state`, `params`), through `ChainControl`, as before. VST3 parameter and bypass changes reach the
//!    processor through its lock-free mailbox at the next block; slot bypass flags and latencies are atomics the
//!    chain reads once per block.
//! 5. **Control** (Tauri commands, tests): [`engine::Engine`] holds the `ChainControl`, the command-queue producer
//!    and the streams.
//!
//! # Delay compensation
//!
//! Every block the chain reports the delay its processing slots really added (`active`) and the delay with every
//! slot processing (`full`, bypassed slots included; Elgato Noise Removal counts its 480 samples even while its own
//! bypass is on). The pipeline delays the chain output by `full − active` and the raw input by `full`, so the
//! chain latency and the raw/processed alignment stay constant while toggling bypass, and follow a state load that
//! changes a plugin's latency on the very next block.

pub mod commands;
pub mod delay;
pub mod devices;
pub mod engine;
pub mod error;
pub mod frame;
pub mod io;
pub mod pipeline;
pub mod stats;
pub mod stream;
pub mod types;

pub use devices::{AudioDevice, AudioDevices};
pub use engine::{Engine, EngineOptions};
pub use error::{AudioError, AudioErrorCode, AudioResult};
pub use frame::StreamFrame;
pub use pipeline::{db_to_gain, BlockChain, Monitor, Pipeline, RtCommand, StreamBlock};
pub use stats::{Counters, CountersSnapshot};
pub use types::{AudioSlot, AudioStatus, ChainSource, LatencyInfo};

/// Output gain when the engine starts (SPEC: −10 dB).
pub const DEFAULT_GAIN_DB: f32 = -10.0;
/// Accepted output gain range (dB).
pub const MIN_GAIN_DB: f32 = -120.0;
pub const MAX_GAIN_DB: f32 = 24.0;
