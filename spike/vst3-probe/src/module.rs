//! Loading a .vst3 module (single-file DLL or bundle) and reading its factory. Win32 only.

use std::ffi::c_void;
use std::path::{Path, PathBuf};

use vst3::Steinberg::*;
use vst3::{ComPtr, Interface};

use crate::com::{read_cstr, tuid_hex};

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LoadLibraryW(name: *const u16) -> *mut c_void;
    fn GetProcAddress(h: *mut c_void, name: *const u8) -> *mut c_void;
    fn FreeLibrary(h: *mut c_void) -> i32;
    fn GetLastError() -> u32;
}

#[repr(C)]
struct Msg {
    hwnd: *mut c_void,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    pt_x: i32,
    pt_y: i32,
    private: u32,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn PeekMessageW(msg: *mut Msg, hwnd: *mut c_void, min: u32, max: u32, remove: u32) -> i32;
    fn TranslateMessage(msg: *const Msg) -> i32;
    fn DispatchMessageW(msg: *const Msg) -> isize;
}

#[link(name = "ole32")]
unsafe extern "system" {
    fn OleInitialize(reserved: *mut c_void) -> i32;
}

pub fn ole_initialize() -> i32 {
    unsafe { OleInitialize(std::ptr::null_mut()) }
}

/// Dispatch pending window messages on this thread (JUCE plugins post async updates to a hidden window).
pub fn pump_messages() -> usize {
    let mut n = 0;
    unsafe {
        let mut m: Msg = std::mem::zeroed();
        while PeekMessageW(&mut m, std::ptr::null_mut(), 0, 0, 1) != 0 {
            TranslateMessage(&m);
            DispatchMessageW(&m);
            n += 1;
        }
    }
    n
}

pub struct Module {
    handle: *mut c_void,
    pub dll: PathBuf,
    pub factory: std::mem::ManuallyDrop<ComPtr<IPluginFactory>>,
    exit_dll: Option<unsafe extern "system" fn() -> bool>,
}

pub struct ClassEntry {
    pub cid: TUID,
    pub category: String,
    pub name: String,
    pub sub_categories: String,
    pub vendor: String,
    pub version: String,
    pub sdk_version: String,
    pub class_flags: u32,
}

/// Resolve a .vst3 path: a bundle directory → Contents/x86_64-win/<name>.vst3; a file → itself.
pub fn resolve_dll(path: &Path) -> PathBuf {
    if path.is_dir() {
        let stem = path.file_name().unwrap_or_default();
        path.join("Contents").join("x86_64-win").join(stem)
    } else {
        path.to_path_buf()
    }
}

impl Module {
    pub fn load(path: &Path) -> Result<Module, String> {
        let dll = resolve_dll(path);
        let wide: Vec<u16> = dll.as_os_str().encode_wide_nul();
        let handle = unsafe { LoadLibraryW(wide.as_ptr()) };
        if handle.is_null() {
            return Err(format!("LoadLibraryW failed, GetLastError={}", unsafe { GetLastError() }));
        }
        println!("  LoadLibraryW OK: {}", dll.display());
        let init = unsafe { GetProcAddress(handle, b"InitDll\0".as_ptr()) };
        let exit = unsafe { GetProcAddress(handle, b"ExitDll\0".as_ptr()) };
        if !init.is_null() {
            let f: unsafe extern "system" fn() -> bool = unsafe { std::mem::transmute(init) };
            let ok = unsafe { f() };
            println!("  InitDll() -> {ok}");
            if !ok {
                return Err("InitDll returned false".into());
            }
        } else {
            println!("  InitDll: not exported");
        }
        let gpf = unsafe { GetProcAddress(handle, b"GetPluginFactory\0".as_ptr()) };
        if gpf.is_null() {
            return Err("GetPluginFactory not exported".into());
        }
        let gpf: unsafe extern "system" fn() -> *mut IPluginFactory = unsafe { std::mem::transmute(gpf) };
        let raw = unsafe { gpf() };
        let factory = unsafe { ComPtr::from_raw(raw) }.ok_or("GetPluginFactory returned null")?;
        let exit_dll = if exit.is_null() { None } else { Some(unsafe { std::mem::transmute(exit) }) };
        Ok(Module { handle, dll, factory: std::mem::ManuallyDrop::new(factory), exit_dll })
    }

    pub fn factory_info(&self) -> String {
        let mut info: PFactoryInfo = unsafe { std::mem::zeroed() };
        let r = unsafe { self.factory.getFactoryInfo(&mut info) };
        format!(
            "vendor={:?} url={:?} email={:?} flags=0x{:X} (result {r})",
            read_cstr(&info.vendor),
            read_cstr(&info.url),
            read_cstr(&info.email),
            info.flags
        )
    }

    pub fn classes(&self) -> Vec<ClassEntry> {
        let n = unsafe { self.factory.countClasses() };
        let f2 = self.factory.cast::<IPluginFactory2>();
        let mut out = vec![];
        for i in 0..n {
            if let Some(f2) = &f2 {
                let mut c: PClassInfo2 = unsafe { std::mem::zeroed() };
                if unsafe { f2.getClassInfo2(i, &mut c) } == kResultOk {
                    out.push(ClassEntry {
                        cid: c.cid,
                        category: read_cstr(&c.category),
                        name: read_cstr(&c.name),
                        sub_categories: read_cstr(&c.subCategories),
                        vendor: read_cstr(&c.vendor),
                        version: read_cstr(&c.version),
                        sdk_version: read_cstr(&c.sdkVersion),
                        class_flags: c.classFlags,
                    });
                    continue;
                }
            }
            let mut c: PClassInfo = unsafe { std::mem::zeroed() };
            if unsafe { self.factory.getClassInfo(i, &mut c) } == kResultOk {
                out.push(ClassEntry {
                    cid: c.cid,
                    category: read_cstr(&c.category),
                    name: read_cstr(&c.name),
                    sub_categories: String::new(),
                    vendor: String::new(),
                    version: String::new(),
                    sdk_version: String::new(),
                    class_flags: 0,
                });
            }
        }
        out
    }

    /// IPluginFactory::createInstance(cid, I::IID).
    pub fn create<I: Interface>(&self, cid: &TUID) -> Result<ComPtr<I>, String> {
        let mut obj: *mut c_void = std::ptr::null_mut();
        let iid = I::IID;
        let r = unsafe { self.factory.createInstance(cid.as_ptr(), iid.as_ptr() as FIDString, &mut obj) };
        if r != kResultOk || obj.is_null() {
            return Err(format!("createInstance(cid={}) failed: tresult=0x{:08X}", tuid_hex(cid), r as u32));
        }
        Ok(unsafe { ComPtr::from_raw(obj as *mut I) }.unwrap())
    }
}

impl Drop for Module {
    fn drop(&mut self) {
        // Release the factory, then ExitDll. FreeLibrary is skipped on purpose: JUCE plugins can leave
        // threads/windows behind, and the probe process exits right after anyway.
        unsafe {
            std::mem::ManuallyDrop::drop(&mut self.factory);
            if let Some(exit) = self.exit_dll {
                let ok = exit();
                println!("  ExitDll() -> {ok}");
            }
        }
        let _ = (self.handle, FreeLibrary as unsafe extern "system" fn(*mut c_void) -> i32);
    }
}

trait EncodeWideNul {
    fn encode_wide_nul(&self) -> Vec<u16>;
}
impl EncodeWideNul for std::ffi::OsStr {
    fn encode_wide_nul(&self) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        self.encode_wide().chain(std::iter::once(0)).collect()
    }
}

/// JUCE's PluginDescription ids for a VST3 class, as a JUCE host (Wave Link) computes them.
/// deprecatedUid = hash over the 16 TUID chars (signed); uniqueId = hash over the 4 FUID longs.
pub fn juce_plugin_ids(cid: &TUID) -> (u32, u32) {
    let mut dep: u32 = 0;
    for c in cid.iter() {
        dep = dep.wrapping_mul(31).wrapping_add(*c as i32 as u32);
    }
    let b: Vec<u8> = cid.iter().map(|c| *c as u8).collect();
    // FUID long getters with COM_COMPATIBLE byte order (Windows).
    let l1 = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
    let l2 = ((b[5] as u32) << 24) | ((b[4] as u32) << 16) | ((b[7] as u32) << 8) | (b[6] as u32);
    let l3 = u32::from_be_bytes([b[8], b[9], b[10], b[11]]);
    let l4 = u32::from_be_bytes([b[12], b[13], b[14], b[15]]);
    let mut uniq: u32 = 0;
    for l in [l1, l2, l3, l4] {
        uniq = uniq.wrapping_mul(31).wrapping_add(l);
    }
    (dep, uniq)
}

/// The class id in the usual "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" (FUID long) form.
pub fn fuid_string(cid: &TUID) -> String {
    let b: Vec<u8> = cid.iter().map(|c| *c as u8).collect();
    let l1 = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
    let l2 = ((b[5] as u32) << 24) | ((b[4] as u32) << 16) | ((b[7] as u32) << 8) | (b[6] as u32);
    let l3 = u32::from_be_bytes([b[8], b[9], b[10], b[11]]);
    let l4 = u32::from_be_bytes([b[12], b[13], b[14], b[15]]);
    format!("{l1:08X}{l2:08X}{l3:08X}{l4:08X}")
}
