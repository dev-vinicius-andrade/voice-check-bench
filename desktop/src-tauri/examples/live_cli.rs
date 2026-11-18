//! Headless live engine over line-delimited JSON, so the TypeScript live noise calibration (src/desktop/calibrate) can
//! run on the real Wave Link mic chain without the app or audio devices (tools/tune-real/calibrate.ts). The mic chain
//! runs through the engine's real-time core (`audio::Pipeline`: delay-compensated bypass, raw delayed by the full chain
//! latency), fed block by block at real-time pace, so Elgato plugins follow their changes on the clock as they do live.
//! Settings.json is only read; point `VCB_WAVELINK_SETTINGS` at a copy.
//!
//! ```text
//! cargo run --release --example live_cli
//! ```
//!
//! One request per stdin line, `{"id": 1, "cmd": "open"}`; one reply per stdout line, `{"id": 1, "ok": …}` or
//! `{"id": 1, "error": {"code": …, "message": …}}` (a line that is not a JSON object with an `id` is not a reply).
//! Commands, with the `audio_*` commands' semantics (audio/engine.rs):
//! - `open` → `{sampleRate, latencySamples, slots: AudioSlot[]}` (replaces an open chain)
//! - `set_param {slot, param, value}` · `set_bypass {slot, bypassed}` · `load_state {slot, parameterState}` → AudioSlot
//! - `stream {input, output, pace}`: raw little-endian f32 file (mono, 48 kHz, whole 480-sample blocks) through the
//!   pipeline, continuing from the last call (no reset), each block `pace` (default true) at real time → output file =
//!   the aligned raw blocks then the processed blocks (f32 × n each) → `{samples, settled, latencySamples}`
//! - `export_states` → ExportedState[]
//! - `wavelink_read` → WlSnapshot
//! - `close` → null; `quit` (or end of input) closes and exits.

use std::io::{BufRead, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rtrb::{Consumer, RingBuffer};
use serde::Serialize;
use serde_json::{json, Value};
use voice_check_bench_desktop_lib::audio::commands::mic_chain;
use voice_check_bench_desktop_lib::audio::pipeline::COMMAND_QUEUE;
use voice_check_bench_desktop_lib::audio::{
    AudioError, AudioSlot, Counters, Monitor, Pipeline, StreamBlock,
};
use voice_check_bench_desktop_lib::chain::{build_chain, ChainControl, ChainProcessor};
use voice_check_bench_desktop_lib::host::{BLOCK, SAMPLE_RATE};
use voice_check_bench_desktop_lib::render::commands::{samples_from_le_bytes, samples_to_le_bytes};
use voice_check_bench_desktop_lib::wavelink::files::read_text;
use voice_check_bench_desktop_lib::wavelink::{
    default_settings_path, hash_text, list_inputs, WlSnapshot,
};

type Reply = Result<Value, Value>;

/// Field order is drop order: the control side unloads the plugins before the pipeline (processor) goes.
struct Live {
    ctl: ChainControl,
    pipeline: Pipeline<ChainProcessor>,
    blocks: Consumer<StreamBlock>,
    _counters: Arc<Counters>,
}

fn fail(code: &str, message: impl Into<String>) -> Value {
    json!({ "code": code, "message": message.into() })
}

fn audio_err(e: impl Into<AudioError>) -> Value {
    serde_json::to_value(e.into()).unwrap_or(Value::Null)
}

fn to_json<T: Serialize>(v: T) -> Reply {
    serde_json::to_value(v).map_err(|e| fail("serialize", e.to_string()))
}

fn arg<'a>(req: &'a Value, key: &str) -> Result<&'a Value, Value> {
    req.get(key)
        .ok_or_else(|| fail("invalidArgument", format!("missing \"{key}\"")))
}

fn num(req: &Value, key: &str) -> Result<f64, Value> {
    arg(req, key)?
        .as_f64()
        .ok_or_else(|| fail("invalidArgument", format!("\"{key}\" is not a number")))
}

fn text<'a>(req: &'a Value, key: &str) -> Result<&'a str, Value> {
    arg(req, key)?
        .as_str()
        .ok_or_else(|| fail("invalidArgument", format!("\"{key}\" is not a string")))
}

fn slot_of(ctl: &ChainControl, i: usize) -> Reply {
    let info = ctl.slot(i).map_err(audio_err)?;
    let params = ctl.params(i).unwrap_or_default();
    to_json(AudioSlot { info, params })
}

fn status(l: &Live) -> Reply {
    let slots: Vec<AudioSlot> = (0..l.ctl.len())
        .filter_map(|i| {
            Some(AudioSlot {
                info: l.ctl.slot(i).ok()?,
                params: l.ctl.params(i).unwrap_or_default(),
            })
        })
        .collect();
    Ok(
        json!({ "sampleRate": SAMPLE_RATE, "latencySamples": l.ctl.full_latency_samples(), "slots": to_json(slots)? }),
    )
}

fn open(live: &mut Option<Live>) -> Reply {
    *live = None;
    let (_source, specs) = mic_chain().map_err(audio_err)?;
    let (ctl, processor) = build_chain(&specs).map_err(audio_err)?;
    ctl.wait_settled();
    let (_cmd_tx, cmd_rx) = RingBuffer::new(COMMAND_QUEUE);
    let (blk_tx, blk_rx) = RingBuffer::<StreamBlock>::new(4096);
    let counters = Arc::new(Counters::default());
    let pipeline = Pipeline::new(
        processor,
        cmd_rx,
        blk_tx,
        counters.clone(),
        Monitor::Off,
        1.0,
    );
    let l = Live {
        ctl,
        pipeline,
        blocks: blk_rx,
        _counters: counters,
    };
    let reply = status(&l);
    *live = Some(l);
    reply
}

fn stream(l: &mut Live, req: &Value) -> Reply {
    let bytes =
        std::fs::read(text(req, "input")?).map_err(|e| fail("invalidArgument", e.to_string()))?;
    let input = samples_from_le_bytes(&bytes)
        .map_err(|e| serde_json::to_value(e).unwrap_or(Value::Null))?;
    if input.len() % BLOCK != 0 || input.len() > 4000 * BLOCK {
        return Err(fail(
            "invalidArgument",
            format!(
                "{} samples is not whole {BLOCK}-sample blocks (≤ 4000)",
                input.len()
            ),
        ));
    }
    let pace = req.get("pace").and_then(Value::as_bool).unwrap_or(true);
    let period = Duration::from_secs_f64(BLOCK as f64 / SAMPLE_RATE as f64);
    let mut out = [0f32; BLOCK];
    let (mut raw, mut processed) = (
        Vec::with_capacity(input.len()),
        Vec::with_capacity(input.len()),
    );
    let (mut settled, mut latency) = (true, 0u32);
    let mut due = Instant::now();
    for block in input.chunks(BLOCK) {
        l.pipeline.process_block(block, &mut out);
        let b = l
            .blocks
            .pop()
            .map_err(|_| fail("chain", "no stream block"))?;
        raw.extend_from_slice(&b.raw);
        processed.extend_from_slice(&b.processed);
        settled &= b.settled;
        latency = b.latency;
        if pace {
            due += period;
            if let Some(wait) = due.checked_duration_since(Instant::now()) {
                std::thread::sleep(wait);
            }
        }
    }
    raw.extend_from_slice(&processed);
    std::fs::write(text(req, "output")?, samples_to_le_bytes(&raw))
        .map_err(|e| fail("invalidArgument", e.to_string()))?;
    Ok(json!({ "samples": input.len(), "settled": settled, "latencySamples": latency }))
}

fn wavelink_read() -> Reply {
    let snap = (|| {
        let path = default_settings_path()?;
        let text = read_text(&path)?;
        Ok(WlSnapshot {
            path: path.display().to_string(),
            hash: hash_text(&text),
            inputs: list_inputs(&text)?,
        })
    })();
    snap.map_err(|e: voice_check_bench_desktop_lib::wavelink::WlError| {
        serde_json::to_value(e).unwrap_or(Value::Null)
    })
    .and_then(to_json)
}

fn handle(live: &mut Option<Live>, req: &Value) -> Reply {
    let cmd = text(req, "cmd")?;
    match cmd {
        "open" => return open(live),
        "wavelink_read" => return wavelink_read(),
        "close" | "quit" => {
            *live = None;
            return Ok(Value::Null);
        }
        _ => {}
    }
    let Some(l) = live.as_mut() else {
        return Err(fail("notRunning", "no chain is open (open first)"));
    };
    let slot = || num(req, "slot").map(|v| v as usize);
    match cmd {
        "set_param" => {
            let (i, id, v) = (slot()?, num(req, "param")? as u32, num(req, "value")?);
            l.ctl.set_param(i, id, v).map_err(audio_err)?;
            slot_of(&l.ctl, i)
        }
        "set_bypass" => {
            let i = slot()?;
            let bypassed = arg(req, "bypassed")?
                .as_bool()
                .ok_or_else(|| fail("invalidArgument", "\"bypassed\" is not a bool"))?;
            l.ctl.set_bypass(i, bypassed).map_err(audio_err)?;
            slot_of(&l.ctl, i)
        }
        "load_state" => {
            let i = slot()?;
            l.ctl
                .load_state(i, text(req, "parameterState")?)
                .map_err(audio_err)?;
            slot_of(&l.ctl, i)
        }
        "export_states" => to_json(l.ctl.export_states().map_err(audio_err)?),
        "stream" => stream(l, req),
        other => Err(fail("invalidArgument", format!("unknown command {other}"))),
    }
}

fn main() {
    let mut live: Option<Live> = None;
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim_start_matches('\u{feff}');
        if line.trim().is_empty() {
            continue;
        }
        let (id, reply, quit) = match serde_json::from_str::<Value>(line) {
            Ok(req) => {
                let quit = req.get("cmd").and_then(Value::as_str) == Some("quit");
                (
                    req.get("id").cloned().unwrap_or(Value::Null),
                    handle(&mut live, &req),
                    quit,
                )
            }
            Err(e) => (
                Value::Null,
                Err(fail("invalidArgument", format!("not JSON: {e}"))),
                false,
            ),
        };
        let msg = match reply {
            Ok(v) => json!({ "id": id, "ok": v }),
            Err(e) => json!({ "id": id, "error": e }),
        };
        if writeln!(out, "{msg}").and_then(|()| out.flush()).is_err() || quit {
            break;
        }
    }
    drop(live);
}
