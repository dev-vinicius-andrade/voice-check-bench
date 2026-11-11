// The running engine: opens the devices, builds the chain, wires the callbacks and the stream thread, and is the
// control side for everything the UI changes. Not real-time: every method may block (plugin calls run on the host
// thread); the audio threads only see lock-free rings and atomics.
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{BufferSize, Stream, StreamConfig, SupportedStreamConfig};
use rtrb::{Producer, RingBuffer};

use super::devices::{self, AudioDevice};
use super::error::{err, AudioError, AudioErrorCode, AudioResult};
use super::io::{is_supported, InputSide, OutputSide, MONITOR_RING_BLOCKS};
use super::pipeline::{db_to_gain, Monitor, Pipeline, RtCommand, COMMAND_QUEUE};
use super::stats::{Counters, CountersSnapshot};
use super::stream::{FrameSink, StreamThread, STREAM_RING_BLOCKS};
use super::types::{AudioSlot, AudioStatus, ChainSource, LatencyInfo};
use super::{MAX_GAIN_DB, MIN_GAIN_DB};
use crate::chain::{build_chain, ChainControl, ChainEntrySpec};
use crate::host::{BLOCK, SAMPLE_RATE};

#[derive(Debug, Clone)]
pub struct EngineOptions {
    pub input_id: Option<String>,
    pub output_id: Option<String>,
    pub monitor: Monitor,
    pub gain_db: f32,
    /// Where the chain came from (reported back in the status).
    pub source: Option<ChainSource>,
}

struct Control {
    commands: Producer<RtCommand>,
    monitor: Monitor,
    gain_db: f32,
}

/// Field order is drop order: the streams stop first, then the stream thread, then the plugins unload.
pub struct Engine {
    input_stream: Stream,
    output_stream: Stream,
    stream_thread: StreamThread,
    chain: ChainControl,
    control: Mutex<Control>,
    counters: Arc<Counters>,
    last_error: Arc<Mutex<Option<String>>>,
    input: AudioDevice,
    output: AudioDevice,
    source: Option<ChainSource>,
}

fn config_of(
    supported: Result<SupportedStreamConfig, cpal::Error>,
    what: &str,
) -> AudioResult<(StreamConfig, cpal::SampleFormat)> {
    let s = supported.map_err(|e| {
        AudioError::new(
            AudioErrorCode::StreamFailed,
            format!("{what}: no default config: {e}"),
        )
    })?;
    if !is_supported(s.sample_format()) {
        return err(
            AudioErrorCode::UnsupportedFormat,
            format!("{what}: sample format {:?}", s.sample_format()),
        );
    }
    let config = StreamConfig {
        channels: s.channels(),
        sample_rate: SAMPLE_RATE,
        buffer_size: BufferSize::Default,
    };
    Ok((config, s.sample_format()))
}

fn stream_error(e: impl std::fmt::Display) -> AudioError {
    AudioError::new(AudioErrorCode::StreamFailed, e.to_string())
}

fn error_callback(
    counters: Arc<Counters>,
    last: Arc<Mutex<Option<String>>>,
    side: &'static str,
) -> impl FnMut(cpal::Error) + Send + 'static {
    // cpal may call this on the audio thread: an Xrun only bumps a counter. Other errors (device lost, …) end the
    // stream anyway; their message is kept with a non-blocking try_lock.
    move |e| {
        if e.kind() == cpal::ErrorKind::Xrun {
            // WASAPI reports a capture data discontinuity as Xrun: audio lost before the engine saw it.
            let c = if side == "input" {
                &counters.input_overruns
            } else {
                &counters.output_underruns
            };
            c.fetch_add(1, Ordering::Relaxed);
            return;
        }
        counters.stream_errors.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut l) = last.try_lock() {
            *l = Some(format!("{side}: {e}"));
        }
    }
}

pub fn check_gain_db(db: f32) -> AudioResult<f32> {
    if db.is_finite() && (MIN_GAIN_DB..=MAX_GAIN_DB).contains(&db) {
        Ok(db)
    } else {
        err(
            AudioErrorCode::InvalidArgument,
            format!("gain {db} dB outside {MIN_GAIN_DB}..={MAX_GAIN_DB} dB"),
        )
    }
}

impl Engine {
    /// Open the devices, build the chain from `chain` (plugins load on the host thread) and start processing.
    /// Frames go to `sink` every 100 ms.
    pub fn start(
        chain: &[ChainEntrySpec],
        opts: &EngineOptions,
        sink: FrameSink,
    ) -> AudioResult<Engine> {
        let gain_db = check_gain_db(opts.gain_db)?;
        let (in_dev, input) = devices::open(opts.input_id.as_deref(), true)?;
        let (out_dev, output) = devices::open(opts.output_id.as_deref(), false)?;
        let (in_cfg, in_fmt) = config_of(in_dev.default_input_config(), &input.name)?;
        let (out_cfg, out_fmt) = config_of(out_dev.default_output_config(), &output.name)?;

        let (ctl, processor) = build_chain(chain)?;
        let counters = Arc::new(Counters::default());
        let last_error = Arc::new(Mutex::new(None));
        let (cmd_tx, cmd_rx) = RingBuffer::new(COMMAND_QUEUE);
        let (blk_tx, blk_rx) = RingBuffer::new(STREAM_RING_BLOCKS);
        let (mon_tx, mon_rx) = RingBuffer::new(BLOCK * MONITOR_RING_BLOCKS);
        let pipeline = Pipeline::new(
            processor,
            cmd_rx,
            blk_tx,
            counters.clone(),
            opts.monitor,
            db_to_gain(gain_db),
        );
        let mut in_side =
            InputSide::new(pipeline, in_cfg.channels as usize, mon_tx, counters.clone());
        let mut out_side = OutputSide::new(mon_rx, out_cfg.channels as usize, counters.clone());
        let timeout = Some(Duration::from_secs(5));

        let output_stream = out_dev
            .build_output_stream_raw(
                out_cfg,
                out_fmt,
                move |data, _| out_side.on_data(data),
                error_callback(counters.clone(), last_error.clone(), "output"),
                timeout,
            )
            .map_err(stream_error)?;
        let input_stream = in_dev
            .build_input_stream_raw(
                in_cfg,
                in_fmt,
                move |data, _| in_side.on_data(data),
                error_callback(counters.clone(), last_error.clone(), "input"),
                timeout,
            )
            .map_err(stream_error)?;
        let stream_thread =
            StreamThread::spawn(blk_rx, counters.clone(), sink).map_err(stream_error)?;
        output_stream.play().map_err(stream_error)?;
        input_stream.play().map_err(stream_error)?;
        Ok(Engine {
            input_stream,
            output_stream,
            stream_thread,
            chain: ctl,
            control: Mutex::new(Control {
                commands: cmd_tx,
                monitor: opts.monitor,
                gain_db,
            }),
            counters,
            last_error,
            input,
            output,
            source: opts.source.clone(),
        })
    }

    /// Stop the streams, the stream thread and unload the plugins (same as dropping it).
    pub fn stop(self) {
        drop(self);
    }

    fn control(&self) -> std::sync::MutexGuard<'_, Control> {
        self.control.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn send(c: &mut Control, cmd: RtCommand) -> AudioResult<()> {
        c.commands.push(cmd).map_err(|_| {
            AudioError::new(
                AudioErrorCode::QueueFull,
                "the audio thread is not taking commands",
            )
        })
    }

    pub fn set_monitor(&self, monitor: Monitor) -> AudioResult<()> {
        let mut c = self.control();
        Self::send(&mut c, RtCommand::Monitor(monitor))?;
        c.monitor = monitor;
        Ok(())
    }

    pub fn set_gain_db(&self, db: f32) -> AudioResult<()> {
        let db = check_gain_db(db)?;
        let mut c = self.control();
        Self::send(&mut c, RtCommand::Gain(db_to_gain(db)))?;
        c.gain_db = db;
        Ok(())
    }

    pub fn chain(&self) -> &ChainControl {
        &self.chain
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

    /// Parameter change: VST3 reaches the processor at the next block (lock-free mailbox), VST2 setParameter runs
    /// on the host thread as VST2 allows. The latency compensation follows on the next block.
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

    /// Slot bypass plus the plugin's own bypass; the slot's latency stays as compensation.
    pub fn set_bypass(&self, slot: usize, bypassed: bool) -> AudioResult<AudioSlot> {
        self.check_slot(slot)?;
        self.chain.set_bypass(slot, bypassed)?;
        self.slot(slot)
    }

    /// Load a Wave Link `ParameterState`; latencies are re-read and the compensation follows on the next block.
    pub fn load_state(&self, slot: usize, parameter_state: &str) -> AudioResult<AudioSlot> {
        self.check_slot(slot)?;
        self.chain.load_state(slot, parameter_state)?;
        self.slot(slot)
    }

    pub fn counters(&self) -> CountersSnapshot {
        self.counters.snapshot()
    }

    pub fn status(&self) -> AudioStatus {
        let (monitor, gain_db) = {
            let c = self.control();
            (c.monitor, c.gain_db)
        };
        let slots = (0..self.chain.len())
            .filter_map(|i| self.slot(i).ok())
            .collect();
        AudioStatus {
            source: self.source.clone(),
            input: self.input.clone(),
            output: self.output.clone(),
            sample_rate: SAMPLE_RATE,
            block_size: BLOCK as u32,
            monitor,
            gain_db,
            latency: LatencyInfo {
                aligned_samples: self.chain.full_latency_samples(),
                active_samples: self.chain.latency_samples(),
            },
            settled: self.chain.is_settled(),
            slots,
            counters: self.counters.snapshot(),
            last_stream_error: self
                .last_error
                .lock()
                .map(|l| l.clone())
                .unwrap_or_default(),
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // Pause first so no callback runs while the fields drop.
        let _ = self.input_stream.pause();
        let _ = self.output_stream.pause();
        self.stream_thread.stop();
    }
}
