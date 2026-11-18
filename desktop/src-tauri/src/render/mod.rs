//! Offline render session (SPEC "Desktop app (v2.0)", Offline render): a recorded raw take (mono f32, 48 kHz) runs
//! through the person's real Wave Link mic chain faster than real time, as often as needed with different settings,
//! without audio devices.
//!
//! - **Own chain.** [`RenderSession::open`] builds its own instance of every plugin with `build_chain` (on the host
//!   thread, like the engine). The live engine's chain is never touched, and the two may run at the same time: they
//!   share nothing but the host thread, which serializes their control calls; the engine processes on its audio
//!   thread and the render on a background thread, each on its own plugin instances. Measured: two sessions of the
//!   same plugins processing at once give the same output as one alone (`tests/render_session.rs`), and the real
//!   engine kept 0 underruns and overruns while 63 whole-take renders ran beside it in the same process.
//! - **One session at a time** (`commands.rs`): opening again unloads the old one first, then builds the new one.
//! - **Settings between runs:** `set_param`, `set_bypass` and `load_state` behave like the engine's twins. They never
//!   overlap a run (the commands hold the session for the whole run).
//! - **A run** ([`RenderSession::run`]):
//!   1. wait until VST3 changes have settled ([`crate::chain::ChainControl::wait_settled`]);
//!   2. wait until every processing Elgato Noise Removal really follows its own bypass (see
//!      `RenderSession::follow_noise_removal`: after a while bypassed it switches on up to ~0.5 s late, on the clock);
//!   3. reset every plugin ([`crate::chain::ChainControl::reset`]: VST2 suspend/resume, VST3 deactivate/activate);
//!   4. process [`PREROLL_SAMPLES`] of silence and drop it (pending VST3 parameter changes land, parameter smoothing
//!      ends before the take);
//!   5. process the take plus trailing zeros in 480-sample blocks and drop the first `latency` samples (the delay of
//!      the slots that process). The output has the input's length and lines up with it sample by sample (filters
//!      still shift the phase by a sample or so). It is not clamped.
//! - **Repeatable:** the same samples and settings give bit-identical output whatever was rendered before (max |diff|
//!   0 measured on the real chain). Silence alone does not get there: ReaFIR and Noise Removal keep state that 2 s of
//!   silence does not clear (runs then differed by up to 0.5); the reset does.

pub mod commands;
pub mod session;

use std::time::Duration;

use serde::Serialize;

pub use session::{RenderSession, RunOptions};

use crate::audio::AudioSlot;

/// Silence processed after the reset, before the take (1 s): longer than every delay line of the chain (ReaFIR 4096,
/// Noise Removal 480) and than parameter smoothing.
pub const PREROLL_SAMPLES: usize = 48_000;
/// How long a run waits for Elgato Noise Removal to follow a bypass change before it fails (it takes up to ~0.5 s).
pub const FOLLOW_TIMEOUT: Duration = Duration::from_secs(3);
/// Longest take a run accepts (10 minutes at 48 kHz).
pub const MAX_RUN_SAMPLES: usize = 48_000 * 600;

/// `render_open` result (mirrored in src/desktop/types.ts RenderStatus).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderStatus {
    pub sample_rate: u32,
    /// Delay of the slots that process now; every run removes it, so its output lines up with its input.
    pub latency_samples: u32,
    pub slots: Vec<AudioSlot>,
}
