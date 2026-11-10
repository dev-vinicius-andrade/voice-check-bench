// Minimal VST2 host FFI: AEffect, VSTPluginMain, the dispatcher opcodes this spike needs, and a host callback.
// Throwaway spike code; not a general-purpose host.
use std::ffi::c_void;
use std::path::Path;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use anyhow::{Context, Result, bail};

pub type HostCallback = extern "C" fn(*mut AEffect, i32, i32, isize, *mut c_void, f32) -> isize;
type Dispatcher = extern "C" fn(*mut AEffect, i32, i32, isize, *mut c_void, f32) -> isize;
type SetParam = extern "C" fn(*mut AEffect, i32, f32);
type GetParam = extern "C" fn(*mut AEffect, i32) -> f32;
type ProcessFn = extern "C" fn(*mut AEffect, *mut *mut f32, *mut *mut f32, i32);
type MainFn = unsafe extern "C" fn(HostCallback) -> *mut AEffect;

pub const VST_MAGIC: i32 = 0x5673_7450; // 'VstP'
pub const FLAG_PROGRAM_CHUNKS: i32 = 1 << 5;
pub const FLAG_CAN_REPLACING: i32 = 1 << 4;

// dispatcher opcodes
pub const EFF_OPEN: i32 = 0;
pub const EFF_CLOSE: i32 = 1;
pub const EFF_SET_PROGRAM: i32 = 2;
pub const EFF_GET_PROGRAM: i32 = 3;
pub const EFF_SET_PROGRAM_NAME: i32 = 4;
pub const EFF_GET_PROGRAM_NAME: i32 = 5;
pub const EFF_GET_PARAM_LABEL: i32 = 6;
pub const EFF_GET_PARAM_DISPLAY: i32 = 7;
pub const EFF_GET_PARAM_NAME: i32 = 8;
pub const EFF_SET_SAMPLE_RATE: i32 = 10;
pub const EFF_SET_BLOCK_SIZE: i32 = 11;
pub const EFF_MAINS_CHANGED: i32 = 12;
pub const EFF_GET_CHUNK: i32 = 23;
pub const EFF_SET_CHUNK: i32 = 24;
pub const EFF_GET_EFFECT_NAME: i32 = 45;
pub const EFF_GET_VENDOR_STRING: i32 = 47;
pub const EFF_GET_VENDOR_VERSION: i32 = 49;
pub const EFF_START_PROCESS: i32 = 71;
pub const EFF_STOP_PROCESS: i32 = 72;

#[repr(C)]
pub struct AEffect {
    pub magic: i32,
    pub dispatcher: Option<Dispatcher>,
    pub process_deprecated: *mut c_void,
    pub set_parameter: Option<SetParam>,
    pub get_parameter: Option<GetParam>,
    pub num_programs: i32,
    pub num_params: i32,
    pub num_inputs: i32,
    pub num_outputs: i32,
    pub flags: i32,
    pub reserved1: isize,
    pub reserved2: isize,
    pub initial_delay: i32,
    pub real_qualities: i32,
    pub off_qualities: i32,
    pub io_ratio: f32,
    pub object: *mut c_void,
    pub user: *mut c_void,
    pub unique_id: i32,
    pub version: i32,
    pub process_replacing: Option<ProcessFn>,
    pub process_double_replacing: *mut c_void,
    pub future: [u8; 56],
}

// ---------------------------------------------------------------- host callback

pub static HOST_SAMPLE_RATE: AtomicU32 = AtomicU32::new(48_000);
pub static HOST_BLOCK_SIZE: AtomicU32 = AtomicU32::new(512);
/// How often each audioMaster opcode (0..63) was asked, for the report.
pub static HOST_OPCODES: [AtomicUsize; 64] = [const { AtomicUsize::new(0) }; 64];
pub static HOST_OPCODES_OTHER: AtomicUsize = AtomicUsize::new(0);

extern "C" fn host_callback(_eff: *mut AEffect, opcode: i32, _index: i32, _value: isize, _ptr: *mut c_void, _opt: f32) -> isize {
    if (0..64).contains(&opcode) {
        HOST_OPCODES[opcode as usize].fetch_add(1, Ordering::Relaxed);
    } else {
        HOST_OPCODES_OTHER.fetch_add(1, Ordering::Relaxed);
    }
    match opcode {
        1 => 2400,                                                          // audioMasterVersion
        16 => HOST_SAMPLE_RATE.load(Ordering::Relaxed) as isize,            // audioMasterGetSampleRate
        17 => HOST_BLOCK_SIZE.load(Ordering::Relaxed) as isize,             // audioMasterGetBlockSize
        _ => 0,
    }
}

pub fn host_opcode_report() -> String {
    let mut parts: Vec<String> = HOST_OPCODES
        .iter()
        .enumerate()
        .filter_map(|(k, n)| {
            let n = n.load(Ordering::Relaxed);
            (n > 0).then(|| format!("{k}x{n}"))
        })
        .collect();
    let other = HOST_OPCODES_OTHER.load(Ordering::Relaxed);
    if other > 0 {
        parts.push(format!("other(>=64 or <0)x{other}"));
    }
    parts.join(", ")
}

// ---------------------------------------------------------------- plugin

pub fn fourcc(v: i32) -> String {
    v.to_be_bytes().iter().map(|&b| if b.is_ascii_graphic() { b as char } else { '.' }).collect()
}

pub struct Plugin {
    eff: *mut AEffect,
    pub label: String,
    max_block: usize,
    in_bufs: Vec<Vec<f32>>,
    out_bufs: Vec<Vec<f32>>,
    in_ptrs: Vec<*mut f32>,
    out_ptrs: Vec<*mut f32>,
    running: bool,
    // Last so it is dropped after effClose.
    _lib: libloading::Library,
}

// The AEffect is only used from one thread at a time (setup on main, then moved to the audio thread).
unsafe impl Send for Plugin {}

impl Plugin {
    pub fn load(path: &Path, label: &str) -> Result<Plugin> {
        let lib = unsafe { libloading::Library::new(path) }.with_context(|| format!("LoadLibrary {}", path.display()))?;
        let main: MainFn = unsafe {
            match lib.get::<MainFn>(b"VSTPluginMain\0") {
                Ok(f) => *f,
                Err(_) => *lib.get::<MainFn>(b"main\0").context("no VSTPluginMain / main export")?,
            }
        };
        let eff = unsafe { main(host_callback) };
        if eff.is_null() {
            bail!("{label}: VSTPluginMain returned null");
        }
        if unsafe { (*eff).magic } != VST_MAGIC {
            bail!("{label}: bad AEffect magic");
        }
        let mut p = Plugin {
            eff,
            label: label.to_string(),
            max_block: 0,
            in_bufs: vec![],
            out_bufs: vec![],
            in_ptrs: vec![],
            out_ptrs: vec![],
            running: false,
            _lib: lib,
        };
        p.dispatch(EFF_OPEN, 0, 0, std::ptr::null_mut(), 0.0);
        Ok(p)
    }

    fn a(&self) -> &AEffect {
        unsafe { &*self.eff }
    }

    pub fn dispatch(&mut self, op: i32, index: i32, value: isize, ptr: *mut c_void, opt: f32) -> isize {
        let d = self.a().dispatcher.expect("dispatcher");
        d(self.eff, op, index, value, ptr, opt)
    }

    pub fn num_params(&self) -> i32 {
        self.a().num_params
    }
    pub fn num_programs(&self) -> i32 {
        self.a().num_programs
    }
    pub fn num_inputs(&self) -> i32 {
        self.a().num_inputs
    }
    pub fn num_outputs(&self) -> i32 {
        self.a().num_outputs
    }
    pub fn flags(&self) -> i32 {
        self.a().flags
    }
    pub fn unique_id(&self) -> i32 {
        self.a().unique_id
    }
    pub fn version(&self) -> i32 {
        self.a().version
    }
    pub fn initial_delay(&self) -> i32 {
        self.a().initial_delay
    }
    pub fn uses_chunks(&self) -> bool {
        self.flags() & FLAG_PROGRAM_CHUNKS != 0
    }

    fn get_string(&mut self, op: i32, index: i32) -> String {
        let mut buf = [0u8; 512];
        self.dispatch(op, index, 0, buf.as_mut_ptr() as *mut c_void, 0.0);
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[..end]).trim().to_string()
    }
    pub fn effect_name(&mut self) -> String {
        self.get_string(EFF_GET_EFFECT_NAME, 0)
    }
    pub fn vendor(&mut self) -> String {
        self.get_string(EFF_GET_VENDOR_STRING, 0)
    }
    pub fn vendor_version(&mut self) -> isize {
        self.dispatch(EFF_GET_VENDOR_VERSION, 0, 0, std::ptr::null_mut(), 0.0)
    }
    pub fn param_name(&mut self, i: i32) -> String {
        self.get_string(EFF_GET_PARAM_NAME, i)
    }
    pub fn param_display(&mut self, i: i32) -> String {
        self.get_string(EFF_GET_PARAM_DISPLAY, i)
    }
    pub fn param_label(&mut self, i: i32) -> String {
        self.get_string(EFF_GET_PARAM_LABEL, i)
    }
    pub fn program_name(&mut self) -> String {
        self.get_string(EFF_GET_PROGRAM_NAME, 0)
    }
    pub fn program(&mut self) -> isize {
        self.dispatch(EFF_GET_PROGRAM, 0, 0, std::ptr::null_mut(), 0.0)
    }
    pub fn set_program(&mut self, k: i32) {
        self.dispatch(EFF_SET_PROGRAM, 0, k as isize, std::ptr::null_mut(), 0.0);
    }
    pub fn set_program_name(&mut self, name: &[u8]) {
        let mut buf = [0u8; 64];
        let n = name.len().min(63);
        buf[..n].copy_from_slice(&name[..n]);
        self.dispatch(EFF_SET_PROGRAM_NAME, 0, 0, buf.as_mut_ptr() as *mut c_void, 0.0);
    }
    pub fn get_param(&self, i: i32) -> f32 {
        (self.a().get_parameter.expect("getParameter"))(self.eff, i)
    }
    pub fn set_param(&mut self, i: i32, v: f32) {
        (self.a().set_parameter.expect("setParameter"))(self.eff, i, v)
    }

    /// effGetChunk; `preset` false = bank chunk (what JUCE stores in an FBCh .fxb).
    pub fn get_chunk(&mut self, preset: bool) -> Vec<u8> {
        let mut p: *mut c_void = std::ptr::null_mut();
        let n = self.dispatch(EFF_GET_CHUNK, preset as i32, 0, &mut p as *mut *mut c_void as *mut c_void, 0.0);
        if n <= 0 || p.is_null() {
            return vec![];
        }
        unsafe { std::slice::from_raw_parts(p as *const u8, n as usize) }.to_vec()
    }

    pub fn set_chunk(&mut self, data: &[u8], preset: bool) -> isize {
        let mut copy = data.to_vec();
        self.dispatch(EFF_SET_CHUNK, preset as i32, copy.len() as isize, copy.as_mut_ptr() as *mut c_void, 0.0)
    }

    /// effSetSampleRate + effSetBlockSize and audio buffers (plugin stays suspended).
    pub fn setup(&mut self, sample_rate: f32, max_block: usize) {
        HOST_SAMPLE_RATE.store(sample_rate as u32, Ordering::Relaxed);
        HOST_BLOCK_SIZE.store(max_block as u32, Ordering::Relaxed);
        self.dispatch(EFF_SET_SAMPLE_RATE, 0, 0, std::ptr::null_mut(), sample_rate);
        self.dispatch(EFF_SET_BLOCK_SIZE, 0, max_block as isize, std::ptr::null_mut(), 0.0);
        self.max_block = max_block;
        let ni = self.num_inputs().max(1) as usize;
        let no = self.num_outputs().max(1) as usize;
        self.in_bufs = vec![vec![0.0; max_block]; ni];
        self.out_bufs = vec![vec![0.0; max_block]; no];
        self.in_ptrs = self.in_bufs.iter_mut().map(|b| b.as_mut_ptr()).collect();
        self.out_ptrs = self.out_bufs.iter_mut().map(|b| b.as_mut_ptr()).collect();
    }

    /// effMainsChanged(1) + effStartProcess.
    pub fn resume(&mut self) {
        self.dispatch(EFF_MAINS_CHANGED, 0, 1, std::ptr::null_mut(), 0.0);
        self.dispatch(EFF_START_PROCESS, 0, 0, std::ptr::null_mut(), 0.0);
        self.running = true;
    }

    pub fn suspend(&mut self) {
        if self.running {
            self.dispatch(EFF_STOP_PROCESS, 0, 0, std::ptr::null_mut(), 0.0);
            self.dispatch(EFF_MAINS_CHANGED, 0, 0, std::ptr::null_mut(), 0.0);
            self.running = false;
        }
    }

    /// Mono in → plugin (mono copied to the first `feed` main inputs, other inputs zero) → left output.
    /// `input.len()` must be <= max_block.
    pub fn process_mono(&mut self, input: &[f32], output: &mut [f32], feed: usize) {
        let n = input.len();
        debug_assert!(n <= self.max_block && output.len() >= n);
        for (c, b) in self.in_bufs.iter_mut().enumerate() {
            if c < feed {
                b[..n].copy_from_slice(input);
            } else {
                b[..n].fill(0.0);
            }
        }
        let f = self.a().process_replacing.expect("processReplacing");
        f(self.eff, self.in_ptrs.as_mut_ptr(), self.out_ptrs.as_mut_ptr(), n as i32);
        output[..n].copy_from_slice(&self.out_bufs[0][..n]);
    }

    pub fn right_output(&self, n: usize) -> &[f32] {
        let k = if self.out_bufs.len() > 1 { 1 } else { 0 };
        &self.out_bufs[k][..n]
    }
}

impl Drop for Plugin {
    fn drop(&mut self) {
        self.suspend();
        self.dispatch(EFF_CLOSE, 0, 0, std::ptr::null_mut(), 0.0);
    }
}
