// The offline render session: its own chain instance, settings changes between runs, repeatable aligned runs.
// See the module doc in render/mod.rs.
use std::time::{Duration, Instant};

use super::{RenderStatus, FOLLOW_TIMEOUT, MAX_RUN_SAMPLES, PREROLL_SAMPLES};
use crate::audio::error::{err, AudioErrorCode, AudioResult};
use crate::audio::AudioSlot;
use crate::chain::{
    build_chain, ChainControl, ChainEntrySpec, ChainProcessor, ExportedState, SlotStatus,
};
use crate::host::vst3::NOISE_REMOVAL_PLUGIN_ID;
use crate::host::{BLOCK, SAMPLE_RATE};

/// Probe blocks for the Noise Removal check are this far apart: it follows its bypass on the clock, not per sample.
const FOLLOW_POLL: Duration = Duration::from_millis(10);

/// Largest |output − input| of a Noise Removal slot that passes audio through (measured: bit-exact; processing
/// delays the probe by 480 samples, so it differs by about the probe's level).
const THROUGH_EPS: f32 = 1e-6;

/// Deterministic low-level noise (about −35 dBFS) for the Noise Removal check.
fn probe_block() -> [f32; BLOCK] {
    let mut x = 0x2545_f491u32;
    std::array::from_fn(|_| {
        x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        ((x >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 0.06
    })
}

/// How a run is processed. [`RunOptions::default`] is what `render_run` uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOptions {
    /// Reset every plugin's processing state first ([`ChainControl::reset`]). Without it runs are not repeatable:
    /// ReaFIR and Noise Removal keep state that silence does not clear.
    pub reset: bool,
    /// Silence processed and dropped before the take (rounded up to whole blocks).
    pub preroll_samples: usize,
    /// Sleep after every block, for diagnostics (compare with real-time pacing); `None` runs as fast as possible.
    pub pace: Option<Duration>,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            reset: true,
            preroll_samples: PREROLL_SAMPLES,
            pace: None,
        }
    }
}

/// Field order is drop order: the control side unloads the plugins (on the host thread) before the processor goes.
pub struct RenderSession {
    chain: ChainControl,
    processor: ChainProcessor,
}

/// A run's input: at most [`MAX_RUN_SAMPLES`], every sample finite.
pub fn check_input(input: &[f32]) -> AudioResult<()> {
    if input.len() > MAX_RUN_SAMPLES {
        return err(
            AudioErrorCode::InvalidArgument,
            format!(
                "{} samples is longer than the {MAX_RUN_SAMPLES} a run takes",
                input.len()
            ),
        );
    }
    if let Some(i) = input.iter().position(|v| !v.is_finite()) {
        return err(
            AudioErrorCode::InvalidArgument,
            format!("sample {i} is not a finite number"),
        );
    }
    Ok(())
}

impl RenderSession {
    /// Build the session's own chain from Wave Link entries (plugins load on the host thread; blocks until done).
    pub fn open(specs: &[ChainEntrySpec]) -> AudioResult<RenderSession> {
        let (chain, processor) = build_chain(specs)?;
        Ok(RenderSession { chain, processor })
    }

    pub fn chain(&self) -> &ChainControl {
        &self.chain
    }

    pub fn status(&self) -> RenderStatus {
        RenderStatus {
            sample_rate: SAMPLE_RATE,
            latency_samples: self.chain.latency_samples(),
            slots: (0..self.chain.len())
                .filter_map(|i| self.slot(i).ok())
                .collect(),
        }
    }

    fn check_slot(&self, slot: usize) -> AudioResult<()> {
        if slot < self.chain.len() {
            Ok(())
        } else {
            err(
                AudioErrorCode::InvalidArgument,
                format!("no chain slot {slot}"),
            )
        }
    }

    /// Slot `i` with its parameters (empty for slots that are not previewable).
    pub fn slot(&self, i: usize) -> AudioResult<AudioSlot> {
        let info = self.chain.slot(i)?;
        let params = self.chain.params(i).unwrap_or_default();
        Ok(AudioSlot { info, params })
    }

    /// Same as `audio_set_param`: VST2 setParameter now, VST3 controller now and processor at the next run.
    pub fn set_param(&self, slot: usize, id: u32, value: f64) -> AudioResult<AudioSlot> {
        self.check_slot(slot)?;
        if !value.is_finite() {
            return err(
                AudioErrorCode::InvalidArgument,
                "parameter value is not a number",
            );
        }
        self.chain.set_param(slot, id, value)?;
        self.slot(slot)
    }

    /// Same as `audio_set_bypass`: the slot and the plugin's own bypass. The next run waits for VST3 to settle.
    pub fn set_bypass(&self, slot: usize, bypassed: bool) -> AudioResult<AudioSlot> {
        self.check_slot(slot)?;
        self.chain.set_bypass(slot, bypassed)?;
        self.slot(slot)
    }

    /// Same as `audio_load_state`: a Wave Link `ParameterState`; parameters and latency are re-read.
    pub fn load_state(&self, slot: usize, parameter_state: &str) -> AudioResult<AudioSlot> {
        self.check_slot(slot)?;
        self.chain.load_state(slot, parameter_state)?;
        self.slot(slot)
    }

    /// Same as `audio_export_states`: every hosted slot's current `ParameterState` and `BypassState`.
    pub fn export_states(&self) -> AudioResult<Vec<ExportedState>> {
        Ok(self.chain.export_states()?)
    }

    /// Render `input` with [`RunOptions::default`]: same length as the input, aligned to it.
    pub fn run(&mut self, input: &[f32]) -> AudioResult<Vec<f32>> {
        self.run_with(input, &RunOptions::default())
    }

    fn block(
        &mut self,
        input: &[f32],
        output: &mut [f32],
        latency: u32,
        pace: Option<Duration>,
    ) -> AudioResult<()> {
        self.processor.process_block(input, output);
        let got = self.processor.last_block_latency().active;
        if got != latency {
            // Only a slot busy on the host thread skips processing, and nothing else uses this chain during a run.
            return err(
                AudioErrorCode::Chain,
                format!("chain latency changed during the run ({latency} -> {got} samples)"),
            );
        }
        if let Some(d) = pace {
            std::thread::sleep(d);
        }
        Ok(())
    }

    /// Every Noise Removal slot that processes in this run, with whether its own bypass is off (it should denoise)
    /// or on (it should pass audio through).
    fn noise_removal_slots(&self) -> Vec<(usize, bool)> {
        let id = format!("{NOISE_REMOVAL_PLUGIN_ID:08x}");
        self.chain
            .slots()
            .into_iter()
            .filter(|s| !s.bypassed)
            .filter(
                |s| matches!(&s.status, SlotStatus::Hosted { plugin_id, .. } if *plugin_id == id),
            )
            .map(|s| {
                let own_bypass = self
                    .chain
                    .params(s.index)
                    .unwrap_or_default()
                    .iter()
                    .any(|p| p.is_bypass && p.normalized >= 0.5);
                (s.index, !own_bypass)
            })
            .collect()
    }

    /// Elgato Noise Removal follows a bypass change on its message thread, on the clock: after it was bypassed for a
    /// while it can take ~0.5 s of wall time, which a fast run never gives it (it would pass the whole take through
    /// untouched). Probe blocks of noise, [`FOLLOW_POLL`] apart, until each processing Noise Removal slot really
    /// denoises (output ≠ input) or really passes through (output = input) as its own bypass says. Returns the
    /// number of probe blocks (the caller resets the chain afterwards).
    fn follow_noise_removal(&mut self, latency: u32) -> AudioResult<usize> {
        let expect = self.noise_removal_slots();
        if expect.is_empty() {
            return Ok(0);
        }
        let probe = probe_block();
        let mut out = [0f32; BLOCK];
        let mut prev = [0f32; BLOCK];
        let start = Instant::now();
        let mut n = 0;
        loop {
            n += 1;
            let mut ready = true;
            prev.copy_from_slice(&probe);
            self.processor
                .process_block_tapped(&probe, &mut out, |k, sig| {
                    if let Some(&(_, denoise)) = expect.iter().find(|(i, _)| *i == k) {
                        let through = sig
                            .iter()
                            .zip(&prev)
                            .all(|(a, b)| (a - b).abs() <= THROUGH_EPS);
                        ready &= through != denoise;
                    }
                    prev.copy_from_slice(sig);
                });
            let got = self.processor.last_block_latency().active;
            if got != latency {
                return err(
                    AudioErrorCode::Chain,
                    format!("chain latency changed during the run ({latency} -> {got} samples)"),
                );
            }
            if ready {
                return Ok(n);
            }
            if start.elapsed() > FOLLOW_TIMEOUT {
                return err(
                    AudioErrorCode::Chain,
                    format!(
                        "Elgato Noise Removal did not follow its bypass within {} ms",
                        FOLLOW_TIMEOUT.as_millis()
                    ),
                );
            }
            std::thread::sleep(FOLLOW_POLL);
        }
    }

    /// Wait for VST3 changes to settle and for Noise Removal to follow its bypass, reset every plugin, process
    /// `opts.preroll_samples` of silence, then the input plus trailing zeros in [`BLOCK`]-sample blocks, and drop the
    /// chain latency from the front.
    pub fn run_with(&mut self, input: &[f32], opts: &RunOptions) -> AudioResult<Vec<f32>> {
        check_input(input)?;
        if input.is_empty() {
            return Ok(vec![]);
        }
        self.chain.wait_settled();
        let latency = self.chain.latency_samples();
        self.follow_noise_removal(latency)?;
        if opts.reset {
            self.chain.reset()?;
        }
        let zeros = [0f32; BLOCK];
        let mut sink = [0f32; BLOCK];
        for _ in 0..opts.preroll_samples.div_ceil(BLOCK) {
            self.block(&zeros, &mut sink, latency, opts.pace)?;
        }
        // Whole blocks only: Noise Removal's delay depends on the block size.
        let lat = latency as usize;
        let total = (input.len() + lat).div_ceil(BLOCK) * BLOCK;
        let mut padded = vec![0f32; total];
        padded[..input.len()].copy_from_slice(input);
        let mut out = vec![0f32; total];
        for (i, o) in padded.chunks(BLOCK).zip(out.chunks_mut(BLOCK)) {
            self.block(i, o, latency, opts.pace)?;
        }
        out.drain(..lat);
        out.truncate(input.len());
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn builtin(name: &str) -> ChainEntrySpec {
        ChainEntrySpec {
            name: name.into(),
            file_path: String::new(),
            bypassed: false,
            parameter_state: String::new(),
        }
    }

    #[test]
    fn placeholder_chain_renders_the_input_unchanged_at_any_length() {
        let mut s = RenderSession::open(&[builtin("VoiceFocus"), builtin("WaveEQ")]).unwrap();
        let st = s.status();
        assert_eq!(st.sample_rate, 48_000);
        assert_eq!(st.latency_samples, 0);
        assert_eq!(st.slots.len(), 2);
        for n in [0usize, 1, 479, 480, 481, 12_345] {
            let input: Vec<f32> = (0..n).map(|k| (k as f32 * 0.01).sin() * 0.5).collect();
            assert_eq!(s.run(&input).unwrap(), input, "length {n}");
        }
        assert!(s.export_states().unwrap().is_empty());
    }

    #[test]
    fn rejects_bad_arguments() {
        let mut s = RenderSession::open(&[builtin("VoiceFocus")]).unwrap();
        let code = |r: AudioResult<AudioSlot>| r.unwrap_err().code;
        assert_eq!(
            code(s.set_param(3, 0, 0.5)),
            AudioErrorCode::InvalidArgument
        );
        assert_eq!(code(s.set_bypass(1, true)), AudioErrorCode::InvalidArgument);
        assert_eq!(
            code(s.load_state(7, "QQ==")),
            AudioErrorCode::InvalidArgument
        );
        assert_eq!(
            code(s.set_param(0, 0, f64::NAN)),
            AudioErrorCode::InvalidArgument
        );
        assert_eq!(
            code(s.set_bypass(0, true)),
            AudioErrorCode::Chain,
            "built-in: not previewable"
        );
        let e = s.run(&[0.0, f32::NAN]).unwrap_err();
        assert_eq!(e.code, AudioErrorCode::InvalidArgument);
        assert!(check_input(&vec![0.0; MAX_RUN_SAMPLES + 1]).is_err());
        assert!(check_input(&[0.0, -1.0, 1.0]).is_ok());
    }
}
