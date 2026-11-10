//! Minimal VST2 ABI: `AEffect`, the dispatcher opcodes the engine uses, and the host callback.

use std::ffi::c_void;

use crate::host::{BLOCK, SAMPLE_RATE};

pub type HostCallback = extern "C" fn(*mut AEffect, i32, i32, isize, *mut c_void, f32) -> isize;
pub type Dispatcher = extern "C" fn(*mut AEffect, i32, i32, isize, *mut c_void, f32) -> isize;
pub type SetParam = extern "C" fn(*mut AEffect, i32, f32);
pub type GetParam = extern "C" fn(*mut AEffect, i32) -> f32;
pub type ProcessFn = extern "C" fn(*mut AEffect, *mut *mut f32, *mut *mut f32, i32);
pub type MainFn = unsafe extern "C" fn(HostCallback) -> *mut AEffect;

pub const VST_MAGIC: i32 = 0x5673_7450; // 'VstP'
pub const FLAG_PROGRAM_CHUNKS: i32 = 1 << 5;

pub const EFF_OPEN: i32 = 0;
pub const EFF_CLOSE: i32 = 1;
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

/// audioMaster callback: version, sample rate and block size; everything else answers 0 (unsupported).
pub extern "C" fn host_callback(
    _eff: *mut AEffect,
    opcode: i32,
    _index: i32,
    _value: isize,
    _ptr: *mut c_void,
    _opt: f32,
) -> isize {
    match opcode {
        1 => 2400,                  // audioMasterVersion
        16 => SAMPLE_RATE as isize, // audioMasterGetSampleRate
        17 => BLOCK as isize,       // audioMasterGetBlockSize
        _ => 0,
    }
}

/// 4-char code as text (non-printable bytes as '.').
pub fn fourcc(v: i32) -> String {
    v.to_be_bytes()
        .iter()
        .map(|&b| if b.is_ascii_graphic() { b as char } else { '.' })
        .collect()
}
