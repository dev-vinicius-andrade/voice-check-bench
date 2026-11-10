//! Plugin host engine: runs the person's Wave Link plugins (ReaPlugs VST2, Elgato VST3) outside Wave Link.
//! Ported from the proven spikes `spike/vst2-host` and `spike/vst3-probe` (see their FINDINGS.md).
//!
//! Fixed format: mono, [`SAMPLE_RATE`] (48 kHz), [`BLOCK`] (480-sample) blocks, the WASAPI shared-mode period and
//! the Elgato Noise Removal frame size.
//!
//! # Threading model
//!
//! Three roles, never more:
//!
//! 1. **Host thread** ([`thread::host`]): one process-wide thread, started on first use and never stopped. It calls
//!    `OleInitialize`, pumps the Win32 message queue every few milliseconds, and runs every job sent to it.
//!    JUCE plugins (all Elgato VST3s) bind their message thread to the thread that first loads them and post async
//!    updates there, so **every plugin is created, controlled and destroyed on this thread**. Control work reaches it
//!    through [`thread::HostThread::run`] (a channel; the caller blocks until the job is done).
//! 2. **Audio thread** (task 39's audio callback): calls only [`crate::chain::ChainProcessor::process_block`] (or the
//!    tapped variant) and [`crate::chain::ChainProcessor::latency_samples`]. `ChainProcessor` is `Send`; it is moved
//!    to the audio thread once.
//! 3. **Any other thread** (Tauri commands, tests): uses [`crate::chain::ChainControl`], whose methods forward to the
//!    host thread and wait. They are *not* real-time safe; never call them from the audio callback.
//!
//! Plugin calls split into two kinds (enforced by `chain`, documented on [`Plugin`]):
//! - *shared-safe*: `params`, `param`, `set_param`, `set_bypass`, `latency_samples` and the plain getters. They run on
//!   the host thread while the audio thread processes, which is what VST2 (setParameter from the UI thread) and VST3
//!   (the edit controller lives on the UI thread) allow by design. VST3 parameter changes are also posted to a
//!   lock-free mailbox that the audio thread hands to the processor as `IParameterChanges` at the next block.
//! - *exclusive*: `process`, `load_state`, `save_state`. Each chain slot has a non-blocking busy flag. The audio
//!   thread only *tries* it: if the host thread holds it (state load or save, a few ms, user-initiated), that slot
//!   passes its input through unchanged for the block. The audio thread never blocks, allocates or locks a mutex.
//!
//! Real-time safe (audio thread): `ChainProcessor::process_block`, `ChainProcessor::process_block_tapped`,
//! `ChainProcessor::latency_samples`, `ChainProcessor::is_settled`. Everything else is control-side.
//!
//! **Settling:** after a VST3 state load or bypass change, Elgato Noise Removal only follows the change once the host
//! thread has pumped messages for ≥ [`SETTLE`] (120 ms). The chain records a deadline; `is_settled()` /
//! `wait_settled()` tell callers when the output is trustworthy. The host thread pumps continuously, so waiting is
//! all that is needed.
//!
//! **Latency:** VST2 reports `initialDelay`; VST3 reports `getLatencySamples`, plus [`NOISE_REMOVAL_EXTRA_LATENCY`]
//! for Elgato Noise Removal, which reports 0 but delays by 480 samples at 480-sample blocks while it processes
//! (with its own bypass on it passes audio through undelayed, so the extra delay then drops to 0).

pub mod thread;
pub mod vst2;
pub mod vst3;

use std::fmt;
use std::path::Path;
use std::time::Duration;

use serde::Serialize;

/// Engine sample rate (Hz).
pub const SAMPLE_RATE: u32 = 48_000;
/// Engine block size (samples). `process` accepts at most this many samples per call.
pub const BLOCK: usize = 480;
/// How long the host thread must pump messages after a VST3 state load or bypass change.
pub const SETTLE: Duration = Duration::from_millis(120);
/// Unreported delay of Elgato Noise Removal at 480-sample blocks while its own bypass is off (measured by the VST3
/// spike; with its bypass on the plugin is an undelayed pass-through).
pub const NOISE_REMOVAL_EXTRA_LATENCY: u32 = 480;

/// Engine error: a readable message (serializable for Tauri commands).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HostError(pub String);

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for HostError {}

impl From<String> for HostError {
    fn from(s: String) -> Self {
        HostError(s)
    }
}

impl From<&str> for HostError {
    fn from(s: &str) -> Self {
        HostError(s.to_string())
    }
}

pub type HostResult<T> = Result<T, HostError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginKind {
    Vst2,
    Vst3,
}

/// One plugin parameter. `normalized` is the value the plugin's own API takes: VST3 normalized 0..1; for VST2 the
/// raw `getParameter` float (ReaPlugs use linear gains above 1, e.g. ReaComp Wet 3.98 = +12 dB).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParamInfo {
    pub id: u32,
    pub name: String,
    pub display: String,
    pub normalized: f64,
    /// The plugin's own bypass (VST3 `kIsBypass` or a parameter named "Bypass").
    pub is_bypass: bool,
}

/// A hosted plugin. Create, control and drop it on the host thread (VST3 requires it; VST2 tolerates any thread).
///
/// *Shared-safe* methods (`&self` getters, `params`, `param`, `set_param`, `set_bypass`, `latency_samples`) may run
/// on the host thread while another thread is inside `process`. *Exclusive* methods (`process`, `load_state`,
/// `save_state`) must not overlap each other; `chain` guarantees it with a per-slot busy flag. `Plugin` is `Send`
/// but not `Sync`; `chain` adds the cross-thread sharing under that contract.
pub enum Plugin {
    Vst2(vst2::Vst2Plugin),
    Vst3(vst3::Vst3Plugin),
}

impl Plugin {
    /// Load by file type: `.vst3` → VST3 (must run on the host thread), anything else → VST2 DLL. The plugin is
    /// ready to process (48 kHz, 480-sample blocks) with its default state.
    pub fn load(path: &Path, name: &str) -> HostResult<Plugin> {
        let is_vst3 = path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("vst3"));
        if is_vst3 {
            Ok(Plugin::Vst3(vst3::Vst3Plugin::load(path, name)?))
        } else {
            Ok(Plugin::Vst2(vst2::Vst2Plugin::load(path, name)?))
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Plugin::Vst2(p) => p.name(),
            Plugin::Vst3(p) => p.name(),
        }
    }

    pub fn kind(&self) -> PluginKind {
        match self {
            Plugin::Vst2(_) => PluginKind::Vst2,
            Plugin::Vst3(_) => PluginKind::Vst3,
        }
    }

    pub fn file_path(&self) -> &Path {
        match self {
            Plugin::Vst2(p) => p.file_path(),
            Plugin::Vst3(p) => p.file_path(),
        }
    }

    /// Wave Link `PluginId`: VST2 uniqueID as 8 hex digits, VST3 the JUCE uniqueId of the audio module class.
    pub fn plugin_id(&self) -> String {
        match self {
            Plugin::Vst2(p) => format!("{:08x}", p.unique_id() as u32),
            Plugin::Vst3(p) => format!("{:08x}", p.plugin_id()),
        }
    }

    /// Current parameter list. Re-read it after every `load_state`: ReaEQ changes its parameter count.
    pub fn params(&self) -> Vec<ParamInfo> {
        match self {
            Plugin::Vst2(p) => p.params(),
            Plugin::Vst3(p) => p.params(),
        }
    }

    pub fn param(&self, id: u32) -> Option<f64> {
        match self {
            Plugin::Vst2(p) => p.param(id),
            Plugin::Vst3(p) => p.param(id),
        }
    }

    pub fn set_param(&self, id: u32, normalized: f64) -> HostResult<()> {
        match self {
            Plugin::Vst2(p) => p.set_param(id, normalized),
            Plugin::Vst3(p) => p.set_param(id, normalized),
        }
    }

    /// Load a Wave Link `ParameterState` (base64 as stored in Settings.json). Exclusive.
    pub fn load_state(&self, parameter_state: &str) -> HostResult<()> {
        match self {
            Plugin::Vst2(p) => p.load_state(parameter_state),
            Plugin::Vst3(p) => p.load_state(parameter_state),
        }
    }

    /// The current state as a Wave Link `ParameterState` string (same format Wave Link writes). Exclusive.
    pub fn save_state(&self) -> HostResult<String> {
        match self {
            Plugin::Vst2(p) => p.save_state(),
            Plugin::Vst3(p) => p.save_state(),
        }
    }

    /// Whether the plugin has its own bypass parameter (VST3 Elgato effects; ReaPlugs have none).
    pub fn has_own_bypass(&self) -> bool {
        match self {
            Plugin::Vst2(_) => false,
            Plugin::Vst3(p) => p.has_own_bypass(),
        }
    }

    /// Set the plugin's own bypass (every VST3 bypass parameter: plugin and wrapper). Returns false when the plugin
    /// has none (the chain then only bypasses the slot).
    pub fn set_bypass(&self, on: bool) -> HostResult<bool> {
        match self {
            Plugin::Vst2(_) => Ok(false),
            Plugin::Vst3(p) => p.set_bypass(on),
        }
    }

    /// Processing delay in samples, including the unreported Noise Removal delay.
    pub fn latency_samples(&self) -> u32 {
        match self {
            Plugin::Vst2(p) => p.latency_samples(),
            Plugin::Vst3(p) => p.latency_samples(),
        }
    }

    /// Whether changes need [`SETTLE`] of message pumping before the output is trustworthy (VST3).
    pub fn needs_settle(&self) -> bool {
        matches!(self, Plugin::Vst3(_))
    }

    /// Mono in → mono out, `input.len() <= BLOCK`, `output.len() >= input.len()`. Exclusive; real-time safe
    /// (no allocation, no locks).
    pub fn process(&self, input: &[f32], output: &mut [f32]) {
        match self {
            Plugin::Vst2(p) => p.process(input, output),
            Plugin::Vst3(p) => p.process(input, output),
        }
    }
}
