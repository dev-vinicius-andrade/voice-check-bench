// The real-time core, free of cpal: one 480-sample block of raw mic in → chain → delay compensation → monitor out,
// plus the aligned raw/processed pair for the UI stream. Runs on the audio (input callback) thread: no allocation,
// no locks, no waiting. Engine-level changes arrive through a lock-free SPSC queue drained before each block.
use std::sync::Arc;
use std::time::Instant;

use rtrb::{Consumer, Producer};
use serde::{Deserialize, Serialize};

use super::delay::DelayLine;
use super::stats::{bump, Counters};
use crate::chain::{BlockLatency, ChainProcessor};
use crate::host::BLOCK;

/// What the monitor output plays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Monitor {
    /// The chain output (delay-compensated).
    Processed,
    /// The raw mic, delayed by the chain latency so switching A/B keeps the timing.
    Raw,
    /// Silence (exact zeros).
    Off,
}

/// A change for the audio thread, applied before the next block.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RtCommand {
    Monitor(Monitor),
    /// Linear output gain.
    Gain(f32),
}

/// Capacity of the control → audio queue.
pub const COMMAND_QUEUE: usize = 64;
/// Largest chain latency that can be compensated and aligned (≈ 1.37 s; ReaFIR alone is 4096).
pub const MAX_ALIGN: usize = 65_536;

/// The chain as the pipeline sees it: [`ChainProcessor`] in the engine, a fake in tests.
pub trait BlockChain: Send {
    /// Process one block (`input.len() == output.len() == BLOCK`) and report the delay it really added.
    fn process(&mut self, input: &[f32], output: &mut [f32]) -> BlockLatency;
    /// False while a VST3 change is settling (output not trustworthy yet).
    fn is_settled(&self) -> bool;
}

impl BlockChain for ChainProcessor {
    fn process(&mut self, input: &[f32], output: &mut [f32]) -> BlockLatency {
        self.process_block(input, output);
        self.last_block_latency()
    }

    fn is_settled(&self) -> bool {
        ChainProcessor::is_settled(self)
    }
}

/// One block for the UI stream: raw (delayed by `latency`) and processed (compensated), sample-aligned.
#[derive(Clone, Copy)]
pub struct StreamBlock {
    pub raw: [f32; BLOCK],
    pub processed: [f32; BLOCK],
    /// Alignment delay applied to `raw`: the chain's full latency (clamped to [`MAX_ALIGN`]).
    pub latency: u32,
    pub settled: bool,
}

impl StreamBlock {
    pub const fn silent() -> Self {
        Self {
            raw: [0.0; BLOCK],
            processed: [0.0; BLOCK],
            latency: 0,
            settled: true,
        }
    }
}

pub struct Pipeline<C: BlockChain> {
    chain: C,
    commands: Consumer<RtCommand>,
    stream: Producer<StreamBlock>,
    counters: Arc<Counters>,
    raw_delay: DelayLine,
    comp_delay: DelayLine,
    chain_out: Vec<f32>,
    block: StreamBlock,
    monitor: Monitor,
    gain: f32,
}

impl<C: BlockChain> Pipeline<C> {
    pub fn new(
        chain: C,
        commands: Consumer<RtCommand>,
        stream: Producer<StreamBlock>,
        counters: Arc<Counters>,
        monitor: Monitor,
        gain: f32,
    ) -> Self {
        Self {
            chain,
            commands,
            stream,
            counters,
            raw_delay: DelayLine::new(MAX_ALIGN),
            comp_delay: DelayLine::new(MAX_ALIGN),
            chain_out: vec![0.0; BLOCK],
            block: StreamBlock::silent(),
            monitor,
            gain,
        }
    }

    /// Apply every queued command. Called only between blocks.
    fn apply_commands(&mut self) {
        while let Ok(cmd) = self.commands.pop() {
            match cmd {
                RtCommand::Monitor(m) => self.monitor = m,
                RtCommand::Gain(g) => self.gain = g,
            }
        }
    }

    /// One block: `input` is raw mic (`BLOCK` samples), `out` receives the monitor signal (`BLOCK` samples).
    pub fn process_block(&mut self, input: &[f32], out: &mut [f32]) {
        let t0 = Instant::now();
        self.apply_commands();
        let lat = self.chain.process(input, &mut self.chain_out);
        let full = (lat.full as usize).min(MAX_ALIGN);
        let comp = full.saturating_sub(lat.active as usize);
        self.raw_delay.process(input, &mut self.block.raw, full);
        self.comp_delay
            .process(&self.chain_out, &mut self.block.processed, comp);
        self.block.latency = full as u32;
        self.block.settled = self.chain.is_settled();

        let src: Option<&[f32]> = match self.monitor {
            Monitor::Processed => Some(&self.block.processed),
            Monitor::Raw => Some(&self.block.raw),
            Monitor::Off => None,
        };
        match src {
            Some(s) => {
                for (o, v) in out.iter_mut().zip(s) {
                    *o = (v * self.gain).clamp(-1.0, 1.0);
                }
            }
            None => out.fill(0.0),
        }

        if self.stream.push(self.block).is_err() {
            bump(&self.counters.stream_dropped);
        }
        bump(&self.counters.blocks);
        let us = t0.elapsed().as_micros().min(u32::MAX as u128) as u32;
        self.counters.process_us.record(us);
    }

    pub fn monitor(&self) -> Monitor {
        self.monitor
    }

    pub fn gain(&self) -> f32 {
        self.gain
    }
}

/// Linear gain of `db` decibels.
pub fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

#[cfg(test)]
#[path = "pipeline_tests.rs"]
mod tests;
