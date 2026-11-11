//! A Wave Link effect chain hosted by the engine: the mic input's effects, in Wave Link order.
//!
//! - [`build_chain`] instantiates every hostable entry on the host thread and loads its stored `ParameterState`.
//!   Entries without a plugin file (VoiceFocus, WaveEQ, … built into Wave Link) and entries that fail to load stay
//!   as "not previewable" slots that pass audio through unchanged.
//! - [`ChainControl`]: control side, any thread except the audio callback; every call runs on the host thread.
//! - [`ChainProcessor`]: audio side, `Send`, real-time safe.
//!
//! Bypass mirrors Wave Link: a bypassed slot (`BypassState`) is skipped (dry pass-through, its latency drops out of
//! [`ChainProcessor::latency_samples`]). [`ChainControl::set_bypass`] sets the slot *and* the plugin's own bypass
//! parameters, so an export writes both consistently. Loading a state never touches either.
//!
//! Delay compensation (task 39) is done by the caller: every processed piece reports its [`BlockLatency`] (what the
//! slots that really processed added, and the full chain delay as if every slot processed), and `audio` delays the
//! output by the difference. A bypassed slot then still costs its latency and the total stays constant.
//!
//! See the threading model in `host/mod.rs`.

use std::cell::UnsafeCell;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::host::thread::host;
use crate::host::{HostError, HostResult, ParamInfo, Plugin, PluginKind, BLOCK, SETTLE};

/// One Wave Link plugin entry, as read from Settings.json (`Name`, `FilePath`, `BypassState`, `ParameterState`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainEntrySpec {
    pub name: String,
    pub file_path: String,
    pub bypassed: bool,
    pub parameter_state: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SlotStatus {
    #[serde(rename_all = "camelCase")]
    Hosted {
        kind: PluginKind,
        plugin_id: String,
        has_own_bypass: bool,
    },
    /// Wave Link built-in effect (empty FilePath): not previewable, kept as is.
    BuiltIn,
    #[serde(rename_all = "camelCase")]
    LoadFailed { error: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotInfo {
    pub index: usize,
    pub name: String,
    pub file_path: String,
    pub status: SlotStatus,
    pub bypassed: bool,
    pub latency_samples: u32,
    /// Delay of the slot while it processes (own bypass off), also while bypassed: what compensation keeps for it.
    pub full_latency_samples: u32,
}

/// A hosted plugin's current state, ready to be written back as its `ParameterState` and `BypassState`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedState {
    pub index: usize,
    pub name: String,
    pub file_path: String,
    pub bypassed: bool,
    pub parameter_state: String,
}

struct Slot {
    name: String,
    file_path: String,
    status: SlotStatus,
    /// Exclusive-access flag: `process`, `load_state`, `save_state` and teardown run only while holding it.
    busy: AtomicBool,
    bypassed: AtomicBool,
    latency: AtomicU32,
    /// [`Plugin::full_latency_samples`]: the slot's delay while processing, whatever its bypass.
    full_latency: AtomicU32,
    /// Mutated (teardown) only on the host thread while holding `busy`.
    plugin: UnsafeCell<Option<Plugin>>,
}

/// Holds `busy` until dropped (also on unwind).
struct Held<'a>(&'a AtomicBool);

impl Drop for Held<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl Slot {
    /// Audio side: never waits.
    fn try_hold(&self) -> Option<Held<'_>> {
        self.busy
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| Held(&self.busy))
    }

    /// Control side: waits for the audio thread to finish its current block (well under a millisecond).
    fn hold(&self) -> Held<'_> {
        let mut spins = 0u32;
        loop {
            if let Some(h) = self.try_hold() {
                return h;
            }
            spins += 1;
            if spins < 64 {
                std::hint::spin_loop();
            } else {
                std::thread::sleep(Duration::from_micros(200));
            }
        }
    }

    /// Re-read both latencies from the plugin (after a state load, parameter or bypass change). The larger value is
    /// stored first, so a reader never sees `latency > full_latency` from a half-done update.
    fn refresh_latency(&self, p: &Plugin) {
        let (now, full) = (p.latency_samples(), p.full_latency_samples());
        if full >= self.full_latency.load(Ordering::Acquire) {
            self.full_latency.store(full, Ordering::Release);
            self.latency.store(now, Ordering::Release);
        } else {
            self.latency.store(now, Ordering::Release);
            self.full_latency.store(full, Ordering::Release);
        }
    }

    fn plugin(&self) -> Option<&Plugin> {
        // SAFETY: the Option is only replaced in `teardown`, on the host thread while holding `busy`; readers are
        // either the host thread (serialized with teardown) or the audio thread holding `busy`.
        unsafe { (*self.plugin.get()).as_ref() }
    }
}

struct Shared {
    slots: Vec<Slot>,
    epoch: Instant,
    settle_until_us: AtomicU64,
}

// SAFETY: see `host/mod.rs`. Shared-safe plugin calls run on the host thread only; exclusive calls (`process`,
// `load_state`, `save_state`, teardown) run only while holding the slot's `busy` flag, and `process` only from the
// single `ChainProcessor`. Everything else in a slot is atomic or immutable.
unsafe impl Sync for Shared {}

impl Shared {
    fn now_us(&self) -> u64 {
        self.epoch.elapsed().as_micros() as u64
    }

    fn bump_settle(&self) {
        self.settle_until_us
            .store(self.now_us() + SETTLE.as_micros() as u64, Ordering::Release);
    }

    fn is_settled(&self) -> bool {
        self.now_us() >= self.settle_until_us.load(Ordering::Acquire)
    }

    fn latency_samples(&self) -> u32 {
        self.slots
            .iter()
            .filter(|s| !s.bypassed.load(Ordering::Acquire))
            .map(|s| s.latency.load(Ordering::Acquire))
            .sum()
    }

    fn full_latency_samples(&self) -> u32 {
        self.slots
            .iter()
            .map(|s| s.full_latency.load(Ordering::Acquire))
            .sum()
    }

    fn slot(&self, i: usize) -> HostResult<&Slot> {
        self.slots
            .get(i)
            .ok_or_else(|| HostError(format!("no chain slot {i}")))
    }

    fn hosted(&self, i: usize) -> HostResult<(&Slot, &Plugin)> {
        let s = self.slot(i)?;
        let p = s
            .plugin()
            .ok_or_else(|| HostError(format!("{}: not previewable", s.name)))?;
        Ok((s, p))
    }
}

fn make_slot(spec: ChainEntrySpec) -> Slot {
    let loaded = if spec.file_path.trim().is_empty() {
        Err(SlotStatus::BuiltIn)
    } else {
        Plugin::load(Path::new(&spec.file_path), &spec.name)
            .and_then(|p| {
                if !spec.parameter_state.trim().is_empty() {
                    p.load_state(&spec.parameter_state)?;
                }
                Ok(p)
            })
            .map_err(|e| SlotStatus::LoadFailed { error: e.0 })
    };
    let (plugin, status) = match loaded {
        Ok(p) => {
            let status = SlotStatus::Hosted {
                kind: p.kind(),
                plugin_id: p.plugin_id(),
                has_own_bypass: p.has_own_bypass(),
            };
            (Some(p), status)
        }
        Err(status) => (None, status),
    };
    Slot {
        latency: AtomicU32::new(plugin.as_ref().map_or(0, Plugin::latency_samples)),
        full_latency: AtomicU32::new(plugin.as_ref().map_or(0, Plugin::full_latency_samples)),
        name: spec.name,
        file_path: spec.file_path,
        status,
        busy: AtomicBool::new(false),
        bypassed: AtomicBool::new(spec.bypassed),
        plugin: UnsafeCell::new(plugin),
    }
}

/// Build a chain from Wave Link entries, in order. Loads plugins on the host thread; blocks until done.
/// The output is trustworthy once [`ChainControl::is_settled`] (VST3 plugins need [`SETTLE`]).
pub fn build_chain(specs: &[ChainEntrySpec]) -> HostResult<(ChainControl, ChainProcessor)> {
    let specs = specs.to_vec();
    let shared = host().run(move || {
        let slots: Vec<Slot> = specs.into_iter().map(make_slot).collect();
        let shared = Shared {
            slots,
            epoch: Instant::now(),
            settle_until_us: AtomicU64::new(0),
        };
        if shared
            .slots
            .iter()
            .any(|s| s.plugin().is_some_and(Plugin::needs_settle))
        {
            shared.bump_settle();
        }
        shared
    })?;
    let shared = Arc::new(shared);
    Ok((
        ChainControl {
            shared: shared.clone(),
        },
        ChainProcessor {
            shared,
            scratch: vec![0.0; BLOCK],
            last: BlockLatency::default(),
        },
    ))
}

/// Control side of a chain. Every method runs on the host thread and blocks the caller; not for the audio callback.
/// Dropping it unloads the plugins (the processor then passes audio through).
pub struct ChainControl {
    shared: Arc<Shared>,
}

impl ChainControl {
    fn on_host<R, F>(&self, f: F) -> HostResult<R>
    where
        R: Send + 'static,
        F: FnOnce(&Shared) -> HostResult<R> + Send + 'static,
    {
        let s = self.shared.clone();
        host().run(move || f(&s))?
    }

    pub fn len(&self) -> usize {
        self.shared.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.shared.slots.is_empty()
    }

    pub fn slots(&self) -> Vec<SlotInfo> {
        self.shared
            .slots
            .iter()
            .enumerate()
            .map(|(index, s)| SlotInfo {
                index,
                name: s.name.clone(),
                file_path: s.file_path.clone(),
                status: s.status.clone(),
                bypassed: s.bypassed.load(Ordering::Acquire),
                latency_samples: s.latency.load(Ordering::Acquire),
                full_latency_samples: s.full_latency.load(Ordering::Acquire),
            })
            .collect()
    }

    /// [`SlotInfo`] of slot `i`.
    pub fn slot(&self, i: usize) -> HostResult<SlotInfo> {
        self.slots()
            .into_iter()
            .nth(i)
            .ok_or_else(|| HostError(format!("no chain slot {i}")))
    }

    /// Current parameters of slot `i` (re-read every call: ReaEQ changes its list after a state load).
    pub fn params(&self, i: usize) -> HostResult<Vec<ParamInfo>> {
        self.on_host(move |s| Ok(s.hosted(i)?.1.params()))
    }

    /// Applies between blocks (VST2 setParameter; VST3 controller now, processor at the next block).
    pub fn set_param(&self, i: usize, id: u32, normalized: f64) -> HostResult<()> {
        self.on_host(move |s| {
            let (slot, p) = s.hosted(i)?;
            p.set_param(id, normalized)?;
            // A bypass parameter can change the latency (Noise Removal).
            slot.refresh_latency(p);
            Ok(())
        })
    }

    /// Wave Link `BypassState` of the slot and the plugin's own bypass, together. VST3 needs [`SETTLE`] after it.
    pub fn set_bypass(&self, i: usize, on: bool) -> HostResult<()> {
        self.on_host(move |s| {
            let (slot, p) = s.hosted(i)?;
            p.set_bypass(on)?;
            slot.refresh_latency(p);
            slot.bypassed.store(on, Ordering::Release);
            if p.needs_settle() {
                s.bump_settle();
            }
            Ok(())
        })
    }

    /// Load a Wave Link `ParameterState` into slot `i`. The slot passes audio through while loading.
    pub fn load_state(&self, i: usize, parameter_state: &str) -> HostResult<()> {
        let state = parameter_state.to_string();
        self.on_host(move |s| {
            let (slot, p) = s.hosted(i)?;
            let held = slot.hold();
            let r = p.load_state(&state);
            slot.refresh_latency(p);
            drop(held);
            if p.needs_settle() {
                s.bump_settle();
            }
            r
        })
    }

    pub fn save_state(&self, i: usize) -> HostResult<String> {
        self.on_host(move |s| {
            let (slot, p) = s.hosted(i)?;
            let _held = slot.hold();
            p.save_state()
        })
    }

    /// Every hosted plugin's current `ParameterState` and `BypassState`, in chain order.
    pub fn export_states(&self) -> HostResult<Vec<ExportedState>> {
        self.on_host(|s| {
            let mut out = vec![];
            for (index, slot) in s.slots.iter().enumerate() {
                let Some(p) = slot.plugin() else { continue };
                let _held = slot.hold();
                out.push(ExportedState {
                    index,
                    name: slot.name.clone(),
                    file_path: slot.file_path.clone(),
                    bypassed: slot.bypassed.load(Ordering::Acquire),
                    parameter_state: p.save_state()?,
                });
            }
            Ok(out)
        })
    }

    /// Total delay of the active (not bypassed) slots, in samples.
    pub fn latency_samples(&self) -> u32 {
        self.shared.latency_samples()
    }

    /// Total delay with every slot processing (bypassed ones included): the constant, compensated chain latency.
    pub fn full_latency_samples(&self) -> u32 {
        self.shared.full_latency_samples()
    }

    pub fn is_settled(&self) -> bool {
        self.shared.is_settled()
    }

    /// Block until the last state load or bypass change has had [`SETTLE`] of message pumping.
    pub fn wait_settled(&self) {
        let left = self
            .shared
            .settle_until_us
            .load(Ordering::Acquire)
            .saturating_sub(self.shared.now_us());
        if left > 0 {
            std::thread::sleep(Duration::from_micros(left));
        }
    }
}

impl Drop for ChainControl {
    fn drop(&mut self) {
        let s = self.shared.clone();
        // If the host thread is gone there is nothing left to tear down safely; ignore.
        let _ = host().run(move || {
            for slot in &s.slots {
                let held = slot.hold();
                // SAFETY: host thread, holding `busy` (see `Slot::plugin`).
                let plugin = unsafe { (*slot.plugin.get()).take() };
                slot.latency.store(0, Ordering::Release);
                slot.full_latency.store(0, Ordering::Release);
                drop(held);
                drop(plugin);
            }
        });
    }
}

/// Delay of one processed piece, read in the same pass that processed it (so it matches what was done).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BlockLatency {
    /// Sum of the latencies of the slots that really processed (not bypassed, not busy, hosted).
    pub active: u32,
    /// Sum of every slot's full latency (as if every slot processed with its own bypass off).
    pub full: u32,
}

impl BlockLatency {
    /// The extra delay that keeps the chain at its full latency.
    pub fn compensation(&self) -> u32 {
        self.full.saturating_sub(self.active)
    }
}

/// Audio side of a chain: move it to the audio thread. Real-time safe: no allocation, no locks, no waiting.
pub struct ChainProcessor {
    shared: Arc<Shared>,
    scratch: Vec<f32>,
    last: BlockLatency,
}

impl ChainProcessor {
    pub fn process_block(&mut self, input: &[f32], output: &mut [f32]) {
        self.process_block_tapped(input, output, |_, _| {});
    }

    /// Process `input` into `output` (same length; ideally exactly [`BLOCK`] samples, longer input is cut into
    /// 480-sample pieces). `tap(slot, signal)` sees each slot's output, in chain order, once per piece. Bypassed and
    /// not previewable slots pass through, as does a slot the host thread is busy loading or saving.
    pub fn process_block_tapped(
        &mut self,
        input: &[f32],
        output: &mut [f32],
        mut tap: impl FnMut(usize, &[f32]),
    ) {
        let n = input.len().min(output.len());
        let mut start = 0;
        while start < n {
            let end = (start + BLOCK).min(n);
            let len = end - start;
            let piece = &mut output[start..end];
            piece.copy_from_slice(&input[start..end]);
            let mut lat = BlockLatency::default();
            for (k, slot) in self.shared.slots.iter().enumerate() {
                lat.full += slot.full_latency.load(Ordering::Acquire);
                if !slot.bypassed.load(Ordering::Acquire) {
                    if let Some(_held) = slot.try_hold() {
                        if let Some(p) = slot.plugin() {
                            lat.active += slot.latency.load(Ordering::Acquire);
                            p.process(piece, &mut self.scratch[..len]);
                            piece.copy_from_slice(&self.scratch[..len]);
                        }
                    }
                }
                tap(k, piece);
            }
            self.last = lat;
            start = end;
        }
    }

    /// Total delay of the active (not bypassed) slots, in samples.
    pub fn latency_samples(&self) -> u32 {
        self.shared.latency_samples()
    }

    /// Delay of the last processed piece: what its slots really added, and the full (compensated) chain latency.
    pub fn last_block_latency(&self) -> BlockLatency {
        self.last
    }

    /// False for [`SETTLE`] after a VST3 state load or bypass change: Noise Removal output is not trustworthy yet.
    pub fn is_settled(&self) -> bool {
        self.shared.is_settled()
    }

    pub fn len(&self) -> usize {
        self.shared.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.shared.slots.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn builtin(name: &str, bypassed: bool) -> ChainEntrySpec {
        ChainEntrySpec {
            name: name.into(),
            file_path: String::new(),
            bypassed,
            parameter_state: "AAAA".into(),
        }
    }

    #[test]
    fn placeholders_pass_audio_through() {
        let specs = vec![
            builtin("VoiceFocus", true),
            builtin("WaveEQ", false),
            ChainEntrySpec {
                name: "Missing".into(),
                file_path: "Z:\\nowhere\\missing.dll".into(),
                bypassed: false,
                parameter_state: String::new(),
            },
        ];
        let (ctl, mut proc_) = build_chain(&specs).unwrap();
        let slots = ctl.slots();
        assert_eq!(slots.len(), 3);
        assert_eq!(slots[0].status, SlotStatus::BuiltIn);
        assert!(slots[0].bypassed);
        assert!(matches!(slots[2].status, SlotStatus::LoadFailed { .. }));
        assert_eq!(ctl.latency_samples(), 0);
        assert_eq!(ctl.full_latency_samples(), 0);
        assert!(ctl.is_settled(), "no VST3, nothing to settle");
        assert!(
            ctl.export_states().unwrap().is_empty(),
            "nothing hostable to export"
        );
        assert!(ctl.params(1).is_err());
        assert!(ctl.set_bypass(1, true).is_err());
        assert!(ctl.params(9).is_err());

        let input: Vec<f32> = (0..1000).map(|k| (k as f32 * 0.01).sin()).collect();
        let mut out = vec![0.0; input.len()];
        let mut taps = vec![0usize; 3];
        proc_.process_block_tapped(&input, &mut out, |k, s| {
            taps[k] += s.len();
        });
        assert_eq!(out, input);
        assert_eq!(proc_.last_block_latency(), BlockLatency::default());
        assert_eq!(
            taps,
            vec![1000, 1000, 1000],
            "every slot tapped over the whole input"
        );
    }

    #[test]
    fn spec_serde_shape() {
        let s: ChainEntrySpec = serde_json::from_str(
            r#"{"name":"ReaGate","filePath":"C:\\x.dll","bypassed":true,"parameterState":"QQ=="}"#,
        )
        .unwrap();
        assert_eq!(s.file_path, "C:\\x.dll");
        assert!(s.bypassed);
        let info = serde_json::to_value(SlotStatus::Hosted {
            kind: PluginKind::Vst3,
            plugin_id: "f4a9d925".into(),
            has_own_bypass: true,
        })
        .unwrap();
        assert_eq!(
            info,
            serde_json::json!({"status":"hosted","kind":"vst3","pluginId":"f4a9d925","hasOwnBypass":true})
        );
    }
}
