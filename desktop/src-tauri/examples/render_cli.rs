//! Headless offline render session over line-delimited JSON, so the TypeScript tuner can run on the real Wave Link
//! mic chain without the app (tools/tune-real). Settings.json is only read; point `VCB_WAVELINK_SETTINGS` at a copy.
//!
//! ```text
//! cargo run --release --example render_cli
//! ```
//!
//! One request per stdin line, `{"id": 1, "cmd": "open"}`; one reply per stdout line, `{"id": 1, "ok": …}` or
//! `{"id": 1, "error": {"code": …, "message": …}}` (a line that is not a JSON object with an `id` is not a reply: a
//! plugin may print). Commands, with the Tauri commands' semantics (render/commands.rs, wavelink/commands.rs):
//! - `open` → RenderStatus (replaces an open session)
//! - `set_param {slot, param, value}` (param = the parameter id) · `set_bypass {slot, bypassed}` · `load_state {slot, parameterState}` → AudioSlot
//! - `run {input, output}`: raw little-endian f32 files (mono, 48 kHz) → `{samples, ms}`
//! - `export_states` → ExportedState[]
//! - `wavelink_read` → WlSnapshot
//! - `wavelink_preview {changes}` → DiffLine[] · `wavelink_export {changes, expectedHash, force}` → FlowReport: the app's
//!   wavelink_preview / wavelink_export (same `export()`, same JSON shapes) on the `VCB_WAVELINK_SETTINGS` copy only,
//!   with a Wave Link that is never running (nothing is closed or started). Refused without the override or on the real
//!   file.
//! - `close` → null; `quit` (or end of input) closes and exits.

use std::io::{BufRead, Write};
use std::time::Instant;

use chrono::Local;
use serde::Serialize;
use serde_json::{json, Value};
use voice_check_bench_desktop_lib::audio::commands::mic_chain;
use voice_check_bench_desktop_lib::render::commands::{samples_from_le_bytes, samples_to_le_bytes};
use voice_check_bench_desktop_lib::render::RenderSession;
use voice_check_bench_desktop_lib::wavelink::files::{read_text, PATH_OVERRIDE_ENV};
use voice_check_bench_desktop_lib::wavelink::process::PACKAGE_FAMILY;
use voice_check_bench_desktop_lib::wavelink::{
    apply, default_settings_path, diff, export, hash_text, list_inputs, ChainChange, Options,
    ProcessControl, Timings, WlResult, WlSnapshot,
};

type Reply = Result<Value, Value>;

fn fail(code: &str, message: impl Into<String>) -> Value {
    json!({ "code": code, "message": message.into() })
}

fn to_json<T: Serialize, E: Serialize>(r: Result<T, E>) -> Reply {
    match r {
        Ok(v) => serde_json::to_value(v).map_err(|e| fail("serialize", e.to_string())),
        Err(e) => Err(serde_json::to_value(e).unwrap_or_else(|e| fail("serialize", e.to_string()))),
    }
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

fn open_session(session: &mut Option<RenderSession>) -> Reply {
    *session = None;
    let (_source, specs) =
        mic_chain().map_err(|e| serde_json::to_value(e).unwrap_or(Value::Null))?;
    let s =
        RenderSession::open(&specs).map_err(|e| serde_json::to_value(e).unwrap_or(Value::Null))?;
    let status = s.status();
    *session = Some(s);
    to_json::<_, Value>(Ok(status))
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
    to_json::<WlSnapshot, voice_check_bench_desktop_lib::wavelink::WlError>(snap)
}

/// A Wave Link that is not running: export never closes or starts anything.
struct NotRunning;

impl ProcessControl for NotRunning {
    fn is_running(&self) -> WlResult<bool> {
        Ok(false)
    }
    fn request_close(&self) -> WlResult<()> {
        Ok(())
    }
    fn force_close(&self) -> WlResult<()> {
        Ok(())
    }
    fn start(&self) -> WlResult<()> {
        Ok(())
    }
}

/// The `VCB_WAVELINK_SETTINGS` copy; refused when the override is missing or points at Wave Link's own file.
fn copy_path() -> Result<std::path::PathBuf, Value> {
    if std::env::var_os(PATH_OVERRIDE_ENV).is_none_or(|p| p.is_empty()) {
        return Err(fail(
            "invalidArgument",
            format!("set {PATH_OVERRIDE_ENV} to a COPY of Settings.json"),
        ));
    }
    let path =
        default_settings_path().map_err(|e| serde_json::to_value(e).unwrap_or(Value::Null))?;
    let canon = |p: &std::path::Path| std::fs::canonicalize(p).ok();
    let real = std::env::var_os("LOCALAPPDATA").map(|b| {
        std::path::PathBuf::from(b)
            .join("Packages")
            .join(PACKAGE_FAMILY)
            .join("LocalState")
            .join("Settings.json")
    });
    let same = real.is_some_and(|r| canon(&r).is_some() && canon(&r) == canon(&path));
    let in_package = path
        .to_string_lossy()
        .to_lowercase()
        .contains(&PACKAGE_FAMILY.to_lowercase());
    if same || in_package {
        return Err(fail(
            "invalidArgument",
            "refusing to write Wave Link's own Settings.json: pass a copy",
        ));
    }
    Ok(path)
}

fn changes_of(req: &Value) -> Result<Vec<ChainChange>, Value> {
    serde_json::from_value(arg(req, "changes")?.clone())
        .map_err(|e| fail("invalidArgument", format!("\"changes\": {e}")))
}

fn wavelink_preview(req: &Value) -> Reply {
    let path = copy_path()?;
    let changes = changes_of(req)?;
    to_json((|| {
        let text = read_text(&path)?;
        diff(&text, &apply(&text, &changes)?)
    })())
}

fn wavelink_export(req: &Value) -> Reply {
    let path = copy_path()?;
    let changes = changes_of(req)?;
    let force = arg(req, "force")?.as_bool().unwrap_or(false);
    let opts = Options {
        force,
        timings: Timings::default(),
        now: Local::now().naive_local(),
    };
    to_json(export(
        &path,
        &NotRunning,
        &changes,
        text(req, "expectedHash")?,
        &opts,
    ))
}

fn run(s: &mut RenderSession, req: &Value) -> Reply {
    let bytes =
        std::fs::read(text(req, "input")?).map_err(|e| fail("invalidArgument", e.to_string()))?;
    let input = samples_from_le_bytes(&bytes)
        .map_err(|e| serde_json::to_value(e).unwrap_or(Value::Null))?;
    let t0 = Instant::now();
    let out = s
        .run(&input)
        .map_err(|e| serde_json::to_value(e).unwrap_or(Value::Null))?;
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    std::fs::write(text(req, "output")?, samples_to_le_bytes(&out))
        .map_err(|e| fail("invalidArgument", e.to_string()))?;
    Ok(json!({ "samples": out.len(), "ms": ms }))
}

fn handle(session: &mut Option<RenderSession>, req: &Value) -> Reply {
    let cmd = text(req, "cmd")?;
    match cmd {
        "open" => return open_session(session),
        "wavelink_read" => return wavelink_read(),
        "wavelink_preview" => return wavelink_preview(req),
        "wavelink_export" => return wavelink_export(req),
        "close" | "quit" => {
            *session = None;
            return Ok(Value::Null);
        }
        _ => {}
    }
    let Some(s) = session.as_mut() else {
        return Err(fail("notRunning", "no render session is open (open first)"));
    };
    let slot = || num(req, "slot").map(|v| v as usize);
    match cmd {
        "set_param" => to_json(s.set_param(slot()?, num(req, "param")? as u32, num(req, "value")?)),
        "set_bypass" => {
            let bypassed = arg(req, "bypassed")?
                .as_bool()
                .ok_or_else(|| fail("invalidArgument", "\"bypassed\" is not a bool"))?;
            to_json(s.set_bypass(slot()?, bypassed))
        }
        "load_state" => to_json(s.load_state(slot()?, text(req, "parameterState")?)),
        "export_states" => to_json(s.export_states()),
        "run" => run(s, req),
        other => Err(fail("invalidArgument", format!("unknown command {other}"))),
    }
}

fn main() {
    let mut session: Option<RenderSession> = None;
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        // a shell pipe may start the stream with a byte order mark
        let line = line.trim_start_matches('\u{feff}');
        if line.trim().is_empty() {
            continue;
        }
        let (id, reply, quit) = match serde_json::from_str::<Value>(line) {
            Ok(req) => {
                let quit = req.get("cmd").and_then(Value::as_str) == Some("quit");
                (
                    req.get("id").cloned().unwrap_or(Value::Null),
                    handle(&mut session, &req),
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
    drop(session);
}
