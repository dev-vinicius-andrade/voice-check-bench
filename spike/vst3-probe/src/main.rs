//! vst3-probe: can the Elgato Wave Link VST3 effects run outside Wave Link?
//!
//! vst3-probe <plugin.vst3> [--host-name NAME] [--settings Settings.copy.json] [--in in.wav --out out.wav]
//!            [--block N] [--realtime] [--dump DIR]
//! Steps: load module + factory → create component/controller → list params → apply Wave Link state and
//! compare getState bytes → optional offline processing of a mono WAV with level analysis.

mod audio;
mod com;
mod module;
mod plugin;
mod state;

use std::path::Path;

use vst3::ComWrapper;
use vst3::Steinberg::IPluginFactory3Trait;
use vst3::Steinberg::Vst::ParameterInfo_::ParameterFlags_;

use com::{tuid_hex, HostApp};
use module::{fuid_string, juce_plugin_ids, pump_messages, Module};
use plugin::{tr, Param, Plugin};

struct Args {
    plugin: String,
    host_name: String,
    settings: Option<String>,
    input: Option<String>,
    output: Option<String>,
    block: usize,
    offline: bool,
    dump: Option<String>,
    params: Vec<(u32, f64)>,
    skip_state: bool,
    stereo: bool,
    context: bool,
    warmup_ms: u64,
    /// Extra delay (samples) to compensate on top of getLatencySamples (measured, e.g. with tools/lag.py).
    extra_delay: usize,
}

fn parse_args() -> Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let mut a = Args {
        plugin: String::new(),
        host_name: "VoiceCheckBench VST3 Probe".into(),
        settings: None,
        input: None,
        output: None,
        block: 480,
        offline: true,
        dump: None,
        params: vec![],
        skip_state: false,
        stereo: false,
        context: false,
        warmup_ms: 0,
        extra_delay: 0,
    };
    while let Some(x) = it.next() {
        match x.as_str() {
            "--host-name" => a.host_name = it.next().ok_or("--host-name needs a value")?,
            "--settings" => a.settings = it.next(),
            "--in" => a.input = it.next(),
            "--out" => a.output = it.next(),
            "--block" => a.block = it.next().ok_or("--block needs a value")?.parse().map_err(|e| format!("{e}"))?,
            "--realtime" => a.offline = false,
            "--dump" => a.dump = it.next(),
            "--no-apply" => a.skip_state = true,
            "--stereo" => a.stereo = true,
            "--context" => a.context = true,
            "--extra-delay" => a.extra_delay = it.next().ok_or("--extra-delay needs a value")?.parse().map_err(|e| format!("{e}"))?,
            "--warmup-ms" => a.warmup_ms = it.next().ok_or("--warmup-ms needs a value")?.parse().map_err(|e| format!("{e}"))?,
            "--param" => {
                let v = it.next().ok_or("--param needs id=normalized")?;
                let (id, val) = v.split_once('=').ok_or("--param needs id=normalized")?;
                a.params.push((id.parse().map_err(|e| format!("{e}"))?, val.parse().map_err(|e| format!("{e}"))?));
            }
            _ if a.plugin.is_empty() => a.plugin = x,
            _ => return Err(format!("unexpected argument {x}")),
        }
    }
    if a.plugin.is_empty() {
        return Err("usage: vst3-probe <plugin.vst3> [--host-name N] [--settings F] [--in W --out W] [--block N] [--realtime] [--dump DIR]".into());
    }
    Ok(a)
}

fn flags_str(f: i32) -> String {
    let mut v = vec![];
    if f & ParameterFlags_::kCanAutomate != 0 {
        v.push("auto");
    }
    if f & ParameterFlags_::kIsReadOnly != 0 {
        v.push("ro");
    }
    if f & ParameterFlags_::kIsList != 0 {
        v.push("list");
    }
    if f & ParameterFlags_::kIsHidden != 0 {
        v.push("hidden");
    }
    if f & ParameterFlags_::kIsProgramChange != 0 {
        v.push("program");
    }
    if f & ParameterFlags_::kIsBypass != 0 {
        v.push("BYPASS");
    }
    v.join(",")
}

fn print_params(ps: &[Param]) {
    println!("  {:>10} | {:<34} | {:<6} | {:>5} | {:>8} | {:>9} | {:>10} | {:<14} | flags", "id", "title", "units", "steps", "default", "normalized", "plain", "string");
    for p in ps {
        println!(
            "  {:>10} | {:<34} | {:<6} | {:>5} | {:>8.4} | {:>10.6} | {:>10.4} | {:<14} | {}",
            p.id,
            p.title,
            p.units,
            p.step_count,
            p.default_norm,
            p.norm,
            p.plain,
            p.text,
            flags_str(p.flags)
        );
    }
}

/// Find the plugin's AudioPluginConfigurations entry in the Settings copy by its FilePath file name.
fn find_stored_state(settings: &str, dll_name: &str) -> Result<Option<(String, String, bool)>, String> {
    let text = std::fs::read_to_string(settings).map_err(|e| format!("read {settings}: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("json: {e}"))?;
    fn walk(v: &serde_json::Value, dll: &str, out: &mut Option<(String, String, bool)>) {
        match v {
            serde_json::Value::Object(m) => {
                if let (Some(fp), Some(ps)) = (m.get("FilePath").and_then(|x| x.as_str()), m.get("ParameterState").and_then(|x| x.as_str())) {
                    let name = fp.rsplit(['\\', '/']).next().unwrap_or("");
                    if out.is_none() && name.eq_ignore_ascii_case(dll) {
                        let plugin_id = m.get("PluginId").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let bypass = m.get("BypassState").and_then(|x| x.as_bool()).unwrap_or(false);
                        *out = Some((ps.to_string(), plugin_id, bypass));
                    }
                }
                for x in m.values() {
                    walk(x, dll, out);
                }
            }
            serde_json::Value::Array(a) => a.iter().for_each(|x| walk(x, dll, out)),
            _ => {}
        }
    }
    let mut out = None;
    walk(&v, dll_name, &mut out);
    Ok(out)
}

fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    let code = run(&args);
    std::process::exit(code);
}

fn run(args: &Args) -> i32 {
    println!("== vst3-probe {} (host name {:?})", args.plugin, args.host_name);
    println!("  OleInitialize -> 0x{:08X}", module::ole_initialize() as u32);
    let host = ComWrapper::new(HostApp { name: args.host_name.clone() });

    // ---------------------------------------------------------------- step 1: load + classes + instantiate
    println!("\n-- STEP 1: load module, factory, classes, instantiate");
    let module = match Module::load(Path::new(&args.plugin)) {
        Ok(m) => m,
        Err(e) => {
            println!("STEP1 FAIL: {e}");
            return 10;
        }
    };
    println!("  factory: {}", module.factory_info());
    if let Some(f3) = module.factory.cast::<vst3::Steinberg::IPluginFactory3>() {
        let r = unsafe { f3.setHostContext(host.as_com_ref::<vst3::Steinberg::Vst::IHostApplication>().unwrap().as_ptr() as *mut _) };
        println!("  IPluginFactory3::setHostContext -> {}", tr(r));
    }
    let classes = module.classes();
    let mut effect_cid = None;
    for c in &classes {
        let (dep, uniq) = juce_plugin_ids(&c.cid);
        println!(
            "  class {:?} category={:?} cid(tuid)={} cid(fuid)={} sub={:?} vendor={:?} version={:?} sdk={:?} flags=0x{:X} juce.uniqueId={:08x} juce.deprecatedUid={:08x}",
            c.name,
            c.category,
            tuid_hex(&c.cid),
            fuid_string(&c.cid),
            c.sub_categories,
            c.vendor,
            c.version,
            c.sdk_version,
            c.class_flags,
            uniq,
            dep
        );
        if c.category == "Audio Module Class" && effect_cid.is_none() {
            effect_cid = Some(c.cid);
        }
    }
    let Some(cid) = effect_cid else {
        println!("STEP1 FAIL: no 'Audio Module Class' class");
        return 11;
    };
    let plugin = match Plugin::create(&module, &cid, &host) {
        Ok(p) => p,
        Err(e) => {
            println!("STEP1 FAIL: {e}");
            return 12;
        }
    };
    for b in plugin.buses() {
        println!("  bus {b}");
    }
    println!("STEP1 PASS");

    // ---------------------------------------------------------------- step 2: parameters
    println!("\n-- STEP 2: parameters (fresh instance, defaults)");
    let defaults = plugin.params();
    println!("  parameter count: {}", defaults.len());
    print_params(&defaults);
    let (r, default_state) = plugin.component_get_state();
    println!("  default IComponent::getState -> {} ({} bytes)", tr(r), default_state.len());
    println!("    {}", state::describe_component_state(&default_state));
    if let Some((r, b)) = plugin.controller_get_state() {
        println!("  default IEditController::getState -> {} ({} bytes)", tr(r), b.len());
    }
    println!("STEP2 {}", if defaults.is_empty() { "FAIL (no parameters)" } else { "PASS" });

    // ---------------------------------------------------------------- step 3: Wave Link state
    if let Some(settings) = &args.settings {
        println!("\n-- STEP 3: apply the state Wave Link stored, read back, compare");
        let dll_name = module.dll.file_name().unwrap().to_string_lossy().to_string();
        match find_stored_state(settings, &dll_name) {
            Err(e) => println!("STEP3 FAIL: {e}"),
            Ok(None) => println!("STEP3 SKIP: no entry with FilePath ending in {dll_name} in the Settings copy"),
            Ok(Some((b64, plugin_id, bypass))) => step3(&plugin, &b64, &plugin_id, bypass, &cid, &defaults, args.dump.as_deref(), &dll_name, !args.skip_state),
        }
    }

    // ---------------------------------------------------------------- step 4: offline processing
    if let (Some(inp), Some(outp)) = (&args.input, &args.output) {
        println!("\n-- STEP 4: offline processing {inp} -> {outp}");
        if let Some(c) = &plugin.controller {
            for (id, v) in &args.params {
                let r = unsafe { vst3::Steinberg::Vst::IEditControllerTrait::setParamNormalized(c, *id, *v) };
                println!("  --param {id}={v}: IEditController::setParamNormalized -> {} (also sent to the processor via IParameterChanges in block 0)", tr(r));
            }
        }
        step4(&plugin, inp, outp, args.block, args.offline, &args.params, &audio::Opts { stereo: args.stereo, context: args.context, warmup_ms: args.warmup_ms }, args.extra_delay);
        let (r, after) = plugin.component_get_state();
        println!("  IComponent::getState after processing -> {}: {}", tr(r), state::describe_component_state(&after));
    }

    println!("\n-- shutdown");
    plugin.shutdown();
    drop(module);
    pump_messages();
    println!("== done");
    0
}

#[allow(clippy::too_many_arguments)]
fn step3(plugin: &Plugin, b64: &str, plugin_id: &str, bypass: bool, cid: &vst3::Steinberg::TUID, defaults: &[Param], dump: Option<&str>, dll_name: &str, apply: bool) {
    let (dep, uniq) = juce_plugin_ids(cid);
    println!(
        "  Settings entry: PluginId={plugin_id:?} BypassState={bypass}; JUCE uniqueId of class = {uniq:08x}, deprecatedUid = {dep:08x} -> PluginId matches {}",
        if plugin_id.eq_ignore_ascii_case(&format!("{uniq:08x}")) {
            "uniqueId"
        } else if plugin_id.eq_ignore_ascii_case(&format!("{dep:08x}")) {
            "deprecatedUid"
        } else {
            "NEITHER"
        }
    );
    let st = match state::decode_parameter_state(b64) {
        Ok(s) => s,
        Err(e) => {
            println!("STEP3 FAIL: cannot decode ParameterState: {e}");
            return;
        }
    };
    println!("  ParameterState: {} b64 chars; outer = 'VC2!' + JUCE XML <VST3PluginState>", b64.len());
    println!("    IComponent: {}", st.component.as_ref().map(|c| format!("{} bytes", c.len())).unwrap_or("absent".into()));
    println!("    IEditController: {}", st.controller.as_ref().map(|c| format!("{} bytes", c.len())).unwrap_or("absent".into()));
    let reencoded = state::encode_parameter_state(st.component.as_deref(), st.controller.as_deref());
    println!("  codec self-check: re-encoding the decoded parts gives the stored base64 string byte-for-byte: {}", reencoded == b64);
    let Some(comp) = &st.component else {
        println!("STEP3 FAIL: no IComponent state");
        return;
    };
    println!("    stored IComponent: {}", state::describe_component_state(comp));
    if let Some(d) = dump {
        let _ = std::fs::create_dir_all(d);
        let _ = std::fs::write(format!("{d}/{dll_name}.stored.component.bin"), comp);
    }

    if !apply {
        println!("STEP3 SKIPPED applying (--no-apply): plugin keeps its default state");
        return;
    }
    for (what, r) in plugin.apply_state(comp, st.controller.as_deref()) {
        println!("  {what} -> {r}");
    }
    let after = plugin.params();
    println!("  parameters after applying the stored state (* = differs from default):");
    for p in &after {
        let d = defaults.iter().find(|q| q.id == p.id);
        let changed = d.map(|q| (q.norm - p.norm).abs() > 1e-9).unwrap_or(true);
        println!(
            "  {} {:>10} {:<34} norm={:>10.6} plain={:>10.4} string={:<14} (default {:.6} {})",
            if changed { "*" } else { " " },
            p.id,
            p.title,
            p.norm,
            p.plain,
            p.text,
            d.map(|q| q.norm).unwrap_or(f64::NAN),
            d.map(|q| q.text.as_str()).unwrap_or("")
        );
    }
    let edits = plugin.handler.edits.lock().unwrap().len();
    let restarts = plugin.handler.restarts.lock().unwrap().clone();
    println!("  component handler saw {edits} performEdit, restartComponent flags {restarts:X?}");

    let (r, back) = plugin.component_get_state();
    println!("  IComponent::getState after setState -> {} ({} bytes)", tr(r), back.len());
    println!("    read back: {}", state::describe_component_state(&back));
    match state::first_diff(comp, &back) {
        None => println!("  BYTE COMPARE IComponent: IDENTICAL ({} bytes)", back.len()),
        Some(i) => println!(
            "  BYTE COMPARE IComponent: DIFFERENT at byte {i} (stored {} bytes, read back {} bytes); stored[{i}..]={:02X?} back[{i}..]={:02X?}",
            comp.len(),
            back.len(),
            &comp[i..comp.len().min(i + 24)],
            &back[i..back.len().min(i + 24)]
        ),
    }
    let ctrl_back = plugin.controller_get_state();
    if let Some((r, b)) = &ctrl_back {
        println!("  IEditController::getState -> {} ({} bytes)", tr(*r), b.len());
    }
    // What Wave Link would store for this instance now (JUCE includes IEditController only when getState == kResultTrue).
    let ctrl_part = ctrl_back.as_ref().filter(|(r, _)| *r == vst3::Steinberg::kResultOk).map(|(_, b)| b.as_slice());
    let ours = state::encode_parameter_state(Some(&back), ctrl_part);
    println!("  rebuilt ParameterState equals the stored Settings.json string: {}", ours == b64);
    if let Some(d) = dump {
        let _ = std::fs::write(format!("{d}/{dll_name}.readback.component.bin"), &back);
        let _ = std::fs::write(format!("{d}/{dll_name}.readback.ParameterState.b64"), &ours);
    }
    let same = state::first_diff(comp, &back).is_none();
    println!("STEP3 {}", if same && r == vst3::Steinberg::kResultOk { "PASS" } else { "PARTIAL (see byte compare)" });
}

fn step4(plugin: &Plugin, inp: &str, outp: &str, block: usize, offline: bool, params: &[(u32, f64)], opts: &audio::Opts, extra_delay: usize) {
    let (input, sr) = match audio::read_mono(inp) {
        Ok(x) => x,
        Err(e) => {
            println!("STEP4 FAIL: {e}");
            return;
        }
    };
    println!("  input: {} samples, {} Hz, {:.2} s", input.len(), sr, input.len() as f64 / sr as f64);
    let rep = match audio::process(plugin, &input, sr as f64, block, offline, params, opts) {
        Ok(r) => r,
        Err(e) => {
            println!("STEP4 FAIL: {e}");
            return;
        }
    };
    for l in &rep.log {
        println!("  {l}");
    }
    let lat = rep.latency as usize + extra_delay;
    if extra_delay > 0 {
        println!("  compensating {lat} samples = reported latency {} + measured extra delay {extra_delay}", rep.latency);
    }
    let aligned: Vec<f32> = rep.output.iter().skip(lat).take(input.len()).copied().collect();
    if let Err(e) = audio::write_mono_f32(outp, &aligned, sr) {
        println!("  write {outp} failed: {e}");
    } else {
        println!("  wrote {outp} (latency-compensated by {lat} samples, float32 mono)");
    }
    let t = &rep.block_times_us;
    let mut sorted = t.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean = t.iter().sum::<f64>() / t.len() as f64;
    let budget = block as f64 / sr as f64 * 1e6;
    println!(
        "  processing: {} blocks of {block} ({} ch); per block mean {:.1} us, median {:.1} us, p99 {:.1} us, max {:.1} us; budget {:.0} us -> mean load {:.1}% of real time",
        t.len(),
        rep.channels,
        mean,
        audio::percentile(&sorted, 50.0),
        audio::percentile(&sorted, 99.0),
        sorted.last().copied().unwrap_or(0.0),
        budget,
        mean / budget * 100.0
    );
    println!("  latency {lat} samples ({:.2} ms), tail {}", lat as f64 / sr as f64 * 1000.0, rep.tail);

    let frame = (sr as usize) / 20; // 50 ms
    let fin = audio::frame_levels(&input, frame);
    let fout = audio::frame_levels(&aligned, frame);
    println!(
        "  overall: in RMS {:.1} dBFS peak {:.1} dBFS | out RMS {:.1} dBFS peak {:.1} dBFS",
        audio::db(audio::rms(&input)),
        audio::db(audio::peak(&input)),
        audio::db(audio::rms(&aligned)),
        audio::db(audio::peak(&aligned))
    );
    for p in [10.0, 50.0, 90.0] {
        println!("  50 ms frame level p{p:.0}: in {:.1} dB, out {:.1} dB", audio::percentile(&fin, p), audio::percentile(&fout, p));
    }
    let p10_in = audio::percentile(&fin, 10.0);
    let p10_out = audio::percentile(&fout, 10.0);
    println!("  noise floor (p10 of 50 ms frames) reduction: {:.1} dB", p10_in - p10_out);
    // Pause frames = quietest 20% of input frames; speech frames = loudest 20%. Same frame index in/out.
    let thr_lo = audio::percentile(&fin, 20.0);
    let thr_hi = audio::percentile(&fin, 80.0);
    let (mut pd, mut pn, mut sd, mut sn) = (0.0, 0, 0.0, 0);
    for (a, b) in fin.iter().zip(fout.iter()) {
        if *a <= thr_lo {
            pd += a - b;
            pn += 1;
        } else if *a >= thr_hi {
            sd += a - b;
            sn += 1;
        }
    }
    println!(
        "  per-frame attenuation: pauses (quietest 20%, {pn} frames) {:.1} dB; speech (loudest 20%, {sn} frames) {:.1} dB",
        pd / pn.max(1) as f64,
        sd / sn.max(1) as f64
    );
    let identical = input.iter().zip(aligned.iter()).all(|(a, b)| (a - b).abs() < 1e-7);
    if let Some(i) = input.iter().zip(aligned.iter()).position(|(a, b)| (a - b).abs() >= 1e-7) {
        println!("  first sample where output differs from input: {i} (block {}, {:.1} ms)", i / block, i as f64 / sr as f64 * 1000.0);
    }
    let zeros = aligned.iter().filter(|v| **v == 0.0).count();
    println!("  exact-zero output samples: {zeros} ({:.1}% of the file)", zeros as f64 / aligned.len() as f64 * 100.0);
    println!("  output identical to input (pass-through): {identical}");
    println!("STEP4 {}", if identical { "PARTIAL (audio passed through unchanged)" } else { "PASS (processed)" });
}
