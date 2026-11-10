//! VST2 hosting for the ReaPlugs Wave Link uses (ReaGate, ReaComp, ReaEQ, ReaFIR). Port of `spike/vst2-host`.
//!
//! State is a JUCE bank ([`bank`]): ReaGate and ReaComp store 19 floats set with setParameter and read back with
//! getParameter; ReaEQ and ReaFIR store `effGetChunk(0)` (bank chunk). ReaFIR re-encodes its noise profile on every
//! save, so compare its states by parameters, never by bytes.

pub mod bank;
pub mod ffi;

use std::cell::UnsafeCell;
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use self::bank::{Body, Program};
use self::ffi::*;
use super::{HostResult, ParamInfo, BLOCK, SAMPLE_RATE};

/// How many plugin inputs get the mono signal (left and right; a sidechain input stays silent).
const FEED: usize = 2;

struct Buffers {
    in_bufs: Vec<Vec<f32>>,
    out_bufs: Vec<Vec<f32>>,
    in_ptrs: Vec<*mut f32>,
    out_ptrs: Vec<*mut f32>,
}

pub struct Vst2Plugin {
    eff: *mut AEffect,
    name: String,
    path: PathBuf,
    latency: AtomicU32,
    running: AtomicBool,
    /// Audio buffers, touched only by `process` (exclusive).
    rt: UnsafeCell<Buffers>,
    // Last so the library is unloaded after effClose.
    _lib: libloading::Library,
}

// SAFETY: the AEffect and buffers are plain heap data owned by this value; moving it to another thread is fine.
// Cross-thread *sharing* is not claimed here (UnsafeCell keeps it !Sync); `chain` adds it under the contract in
// `host/mod.rs`.
unsafe impl Send for Vst2Plugin {}

impl Vst2Plugin {
    /// Load the DLL, open the effect, set 48 kHz / 480 and resume it (default state).
    pub fn load(path: &Path, name: &str) -> HostResult<Vst2Plugin> {
        let lib = unsafe { libloading::Library::new(path) }
            .map_err(|e| format!("{name}: LoadLibrary {}: {e}", path.display()))?;
        let main: MainFn = unsafe {
            match lib.get::<MainFn>(b"VSTPluginMain\0") {
                Ok(f) => *f,
                Err(_) => *lib
                    .get::<MainFn>(b"main\0")
                    .map_err(|_| format!("{name}: no VSTPluginMain / main export"))?,
            }
        };
        let eff = unsafe { main(host_callback) };
        if eff.is_null() {
            return Err(format!("{name}: VSTPluginMain returned null").into());
        }
        let a = unsafe { &*eff };
        if a.magic != VST_MAGIC || a.dispatcher.is_none() || a.process_replacing.is_none() {
            return Err(format!(
                "{name}: not a usable VST2 effect (magic, dispatcher or processReplacing missing)"
            )
            .into());
        }
        if a.set_parameter.is_none() || a.get_parameter.is_none() {
            return Err(format!("{name}: no setParameter/getParameter").into());
        }
        let ni = a.num_inputs.max(1) as usize;
        let no = a.num_outputs.max(1) as usize;
        let mut in_bufs = vec![vec![0.0f32; BLOCK]; ni];
        let mut out_bufs = vec![vec![0.0f32; BLOCK]; no];
        let in_ptrs = in_bufs.iter_mut().map(|b| b.as_mut_ptr()).collect();
        let out_ptrs = out_bufs.iter_mut().map(|b| b.as_mut_ptr()).collect();
        let p = Vst2Plugin {
            eff,
            name: name.to_string(),
            path: path.to_path_buf(),
            latency: AtomicU32::new(0),
            running: AtomicBool::new(false),
            rt: UnsafeCell::new(Buffers {
                in_bufs,
                out_bufs,
                in_ptrs,
                out_ptrs,
            }),
            _lib: lib,
        };
        p.dispatch(EFF_OPEN, 0, 0, std::ptr::null_mut(), 0.0);
        p.dispatch(
            EFF_SET_SAMPLE_RATE,
            0,
            0,
            std::ptr::null_mut(),
            SAMPLE_RATE as f32,
        );
        p.dispatch(
            EFF_SET_BLOCK_SIZE,
            0,
            BLOCK as isize,
            std::ptr::null_mut(),
            0.0,
        );
        p.resume();
        Ok(p)
    }

    fn a(&self) -> &AEffect {
        unsafe { &*self.eff }
    }

    fn dispatch(&self, op: i32, index: i32, value: isize, ptr: *mut c_void, opt: f32) -> isize {
        let d = self.a().dispatcher.expect("checked at load");
        d(self.eff, op, index, value, ptr, opt)
    }

    fn get_string(&self, op: i32, index: i32) -> String {
        let mut buf = [0u8; 512];
        self.dispatch(op, index, 0, buf.as_mut_ptr() as *mut c_void, 0.0);
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[..end]).trim().to_string()
    }

    fn resume(&self) {
        self.dispatch(EFF_MAINS_CHANGED, 0, 1, std::ptr::null_mut(), 0.0);
        self.dispatch(EFF_START_PROCESS, 0, 0, std::ptr::null_mut(), 0.0);
        self.running.store(true, Ordering::Release);
        self.latency
            .store(self.a().initial_delay.max(0) as u32, Ordering::Release);
    }

    fn suspend(&self) {
        if self.running.swap(false, Ordering::AcqRel) {
            self.dispatch(EFF_STOP_PROCESS, 0, 0, std::ptr::null_mut(), 0.0);
            self.dispatch(EFF_MAINS_CHANGED, 0, 0, std::ptr::null_mut(), 0.0);
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn file_path(&self) -> &Path {
        &self.path
    }

    pub fn unique_id(&self) -> i32 {
        self.a().unique_id
    }

    pub fn num_params(&self) -> i32 {
        self.a().num_params
    }

    pub fn uses_chunks(&self) -> bool {
        self.a().flags & FLAG_PROGRAM_CHUNKS != 0
    }

    pub fn latency_samples(&self) -> u32 {
        self.latency.load(Ordering::Acquire)
    }

    fn raw_param(&self, i: i32) -> f32 {
        (self.a().get_parameter.expect("checked at load"))(self.eff, i)
    }

    /// Parameter list, re-read from the plugin every time (ReaEQ changes numParams after a state load).
    pub fn params(&self) -> Vec<ParamInfo> {
        (0..self.num_params())
            .map(|k| ParamInfo {
                id: k as u32,
                name: self.get_string(EFF_GET_PARAM_NAME, k),
                display: format!(
                    "{} {}",
                    self.get_string(EFF_GET_PARAM_DISPLAY, k),
                    self.get_string(EFF_GET_PARAM_LABEL, k)
                )
                .trim()
                .to_string(),
                normalized: self.raw_param(k) as f64,
                is_bypass: false,
            })
            .collect()
    }

    pub fn param(&self, id: u32) -> Option<f64> {
        let k = i32::try_from(id).ok().filter(|k| *k < self.num_params())?;
        Some(self.raw_param(k) as f64)
    }

    pub fn set_param(&self, id: u32, value: f64) -> HostResult<()> {
        let k = i32::try_from(id)
            .ok()
            .filter(|k| *k < self.num_params())
            .ok_or_else(|| format!("{}: no parameter {id}", self.name))?;
        (self.a().set_parameter.expect("checked at load"))(self.eff, k, value as f32);
        Ok(())
    }

    /// Load a Wave Link `ParameterState` like JUCE's loadFromFXBFile: FBCh → effSetChunk(bank), FxBk → program name
    /// and setParameter for every value. Suspends around the load and re-reads the latency.
    pub fn load_state(&self, parameter_state: &str) -> HostResult<()> {
        let blob = STANDARD
            .decode(parameter_state.trim())
            .map_err(|e| format!("{}: ParameterState base64: {e}", self.name))?;
        let f = bank::parse(&blob)?;
        if f.fx_id != self.unique_id() {
            return Err(format!(
                "{}: state is for fxID {}, plugin is {}",
                self.name,
                fourcc(f.fx_id),
                fourcc(self.unique_id())
            )
            .into());
        }
        if matches!(f.body, Body::Chunk(_)) && !self.uses_chunks() {
            return Err(format!(
                "{}: state is a chunk but the plugin has no program chunks",
                self.name
            )
            .into());
        }
        self.suspend();
        match &f.body {
            Body::Chunk(c) => {
                let mut copy = c.clone();
                self.dispatch(
                    EFF_SET_CHUNK,
                    0,
                    copy.len() as isize,
                    copy.as_mut_ptr() as *mut c_void,
                    0.0,
                );
            }
            Body::Bank(progs) => {
                let cur = self
                    .dispatch(EFF_GET_PROGRAM, 0, 0, std::ptr::null_mut(), 0.0)
                    .max(0) as usize;
                if let Some(prog) = progs.get(cur).or(progs.first()) {
                    let mut name = [0u8; 64];
                    let n = prog.name.iter().position(|&b| b == 0).unwrap_or(28).min(63);
                    name[..n].copy_from_slice(&prog.name[..n]);
                    self.dispatch(
                        EFF_SET_PROGRAM_NAME,
                        0,
                        0,
                        name.as_mut_ptr() as *mut c_void,
                        0.0,
                    );
                    let set = self.a().set_parameter.expect("checked at load");
                    for (k, v) in prog.params.iter().enumerate() {
                        set(self.eff, k as i32, *v);
                    }
                }
            }
        }
        self.resume();
        Ok(())
    }

    /// The state as JUCE's saveToFXBFile(isFXB = true) writes it (= what Wave Link stores), base64.
    pub fn save_state(&self) -> HostResult<String> {
        let num_programs = self.a().num_programs;
        let body = if self.uses_chunks() {
            let mut p: *mut c_void = std::ptr::null_mut();
            let n = self.dispatch(
                EFF_GET_CHUNK,
                0,
                0,
                &mut p as *mut *mut c_void as *mut c_void,
                0.0,
            );
            if n <= 0 || p.is_null() {
                return Err(format!("{}: effGetChunk returned nothing", self.name).into());
            }
            Body::Chunk(unsafe { std::slice::from_raw_parts(p as *const u8, n as usize) }.to_vec())
        } else {
            let name = bank::program_name(&self.get_string(EFF_GET_PROGRAM_NAME, 0));
            let params = (0..self.num_params()).map(|k| self.raw_param(k)).collect();
            // Wave Link's ReaPlugs have numPrograms 1; more programs would need setProgram per program.
            Body::Bank(vec![Program { name, params }; num_programs.max(1) as usize])
        };
        Ok(STANDARD.encode(bank::build(
            self.unique_id(),
            self.a().version,
            num_programs,
            &body,
        )))
    }

    /// Mono in → inputs 1 and 2 (others silent) → left output. Real-time safe.
    pub fn process(&self, input: &[f32], output: &mut [f32]) {
        let n = input.len().min(BLOCK).min(output.len());
        // SAFETY: `process` is exclusive (see host/mod.rs), so nothing else touches the buffers now.
        let rt = unsafe { &mut *self.rt.get() };
        for (c, b) in rt.in_bufs.iter_mut().enumerate() {
            if c < FEED {
                b[..n].copy_from_slice(&input[..n]);
            } else {
                b[..n].fill(0.0);
            }
        }
        let f = self.a().process_replacing.expect("checked at load");
        f(
            self.eff,
            rt.in_ptrs.as_mut_ptr(),
            rt.out_ptrs.as_mut_ptr(),
            n as i32,
        );
        output[..n].copy_from_slice(&rt.out_bufs[0][..n]);
    }
}

impl Drop for Vst2Plugin {
    fn drop(&mut self) {
        self.suspend();
        self.dispatch(EFF_CLOSE, 0, 0, std::ptr::null_mut(), 0.0);
    }
}
