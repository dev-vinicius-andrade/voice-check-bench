//! Loading a .vst3 module (single-file DLL or bundle), its factory and classes, and the JUCE plugin ids Wave Link
//! stores as `PluginId`. Port of `spike/vst3-probe/src/module.rs`.

use std::ffi::c_void;
use std::path::{Path, PathBuf};

use vst3::Steinberg::*;
use vst3::{ComPtr, Interface};

use super::com::read_cstr;
use crate::host::HostResult;

pub struct ClassEntry {
    pub cid: TUID,
    pub category: String,
    pub name: String,
}

pub struct Module {
    // Released in Drop before ExitDll.
    pub factory: std::mem::ManuallyDrop<ComPtr<IPluginFactory>>,
    exit_dll: Option<unsafe extern "system" fn() -> bool>,
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
    /// LoadLibrary + InitDll + GetPluginFactory. FreeLibrary is never called: JUCE plugins can leave threads and
    /// windows behind, and the module stays mapped for the life of the process.
    pub fn load(path: &Path) -> HostResult<Module> {
        let dll = resolve_dll(path);
        let handle = win::load_library(&dll)?;
        let init = win::proc_address(handle, b"InitDll\0");
        let exit = win::proc_address(handle, b"ExitDll\0");
        if !init.is_null() {
            let f: unsafe extern "system" fn() -> bool = unsafe { std::mem::transmute(init) };
            if !unsafe { f() } {
                return Err(format!("{}: InitDll returned false", dll.display()).into());
            }
        }
        let gpf = win::proc_address(handle, b"GetPluginFactory\0");
        if gpf.is_null() {
            return Err(format!("{}: GetPluginFactory not exported", dll.display()).into());
        }
        let gpf: unsafe extern "system" fn() -> *mut IPluginFactory =
            unsafe { std::mem::transmute(gpf) };
        let factory = unsafe { ComPtr::from_raw(gpf()) }
            .ok_or_else(|| format!("{}: GetPluginFactory returned null", dll.display()))?;
        let exit_dll = if exit.is_null() {
            None
        } else {
            Some(unsafe {
                std::mem::transmute::<*mut c_void, unsafe extern "system" fn() -> bool>(exit)
            })
        };
        Ok(Module {
            factory: std::mem::ManuallyDrop::new(factory),
            exit_dll,
        })
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
                });
            }
        }
        out
    }

    /// IPluginFactory::createInstance(cid, I::IID).
    pub fn create<I: Interface>(&self, cid: &TUID) -> HostResult<ComPtr<I>> {
        let mut obj: *mut c_void = std::ptr::null_mut();
        let iid = I::IID;
        let r = unsafe {
            self.factory
                .createInstance(cid.as_ptr(), iid.as_ptr() as FIDString, &mut obj)
        };
        if r != kResultOk || obj.is_null() {
            return Err(format!("createInstance failed: tresult 0x{:08X}", r as u32).into());
        }
        unsafe { ComPtr::from_raw(obj as *mut I) }
            .ok_or_else(|| "createInstance returned null".into())
    }
}

impl Drop for Module {
    fn drop(&mut self) {
        unsafe {
            std::mem::ManuallyDrop::drop(&mut self.factory);
            if let Some(exit) = self.exit_dll {
                exit();
            }
        }
    }
}

/// The four FUID longs of a class id (COM-compatible byte order, as on Windows).
fn fuid_longs(b: &[u8; 16]) -> [u32; 4] {
    [
        u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
        ((b[5] as u32) << 24) | ((b[4] as u32) << 16) | ((b[7] as u32) << 8) | (b[6] as u32),
        u32::from_be_bytes([b[8], b[9], b[10], b[11]]),
        u32::from_be_bytes([b[12], b[13], b[14], b[15]]),
    ]
}

/// JUCE `PluginDescription` ids of a VST3 class as a JUCE host (Wave Link) computes them:
/// (uniqueId = `h*31 + long` over the 4 FUID longs → Wave Link's `PluginId`, deprecatedUid = the same over the 16
/// signed TUID chars).
pub fn juce_plugin_ids(cid: &[u8; 16]) -> (u32, u32) {
    let unique = fuid_longs(cid)
        .iter()
        .fold(0u32, |h, l| h.wrapping_mul(31).wrapping_add(*l));
    let deprecated = cid.iter().fold(0u32, |h, c| {
        h.wrapping_mul(31).wrapping_add(*c as i8 as i32 as u32)
    });
    (unique, deprecated)
}

/// The class id in FUID form ("ABCDEF01..." 32 hex digits).
pub fn fuid_string(cid: &[u8; 16]) -> String {
    fuid_longs(cid).iter().map(|l| format!("{l:08X}")).collect()
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use crate::host::HostResult;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LoadLibraryW(name: *const u16) -> *mut c_void;
        fn GetProcAddress(h: *mut c_void, name: *const u8) -> *mut c_void;
        fn GetLastError() -> u32;
    }

    pub fn load_library(dll: &Path) -> HostResult<*mut c_void> {
        let wide: Vec<u16> = dll
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let h = unsafe { LoadLibraryW(wide.as_ptr()) };
        if h.is_null() {
            return Err(format!(
                "LoadLibraryW {} failed, GetLastError={}",
                dll.display(),
                unsafe { GetLastError() }
            )
            .into());
        }
        Ok(h)
    }

    pub fn proc_address(h: *mut c_void, name: &[u8]) -> *mut c_void {
        unsafe { GetProcAddress(h, name.as_ptr()) }
    }
}

#[cfg(not(windows))]
mod win {
    use std::ffi::c_void;
    use std::path::Path;

    use crate::host::HostResult;

    pub fn load_library(_dll: &Path) -> HostResult<*mut c_void> {
        Err("VST3 hosting is Windows-only".into())
    }

    pub fn proc_address(_h: *mut c_void, _name: &[u8]) -> *mut c_void {
        std::ptr::null_mut()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex16(s: &str) -> [u8; 16] {
        let mut b = [0u8; 16];
        for (i, out) in b.iter_mut().enumerate() {
            *out = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
        }
        b
    }

    #[test]
    fn plugin_id_matches_juce_for_elgato_class_ids() {
        // Public class ids of the Elgato "Audio Module Class" (TUID byte order), with the ids JUCE derives.
        let nr = hex16("01EFCDAB8291EBFA4D616E7547756770");
        assert_eq!(fuid_string(&nr), "ABCDEF019182FAEB4D616E7547756770");
        assert_eq!(juce_plugin_ids(&nr), (0xf4a9d925, 0xe954837c));
        assert_eq!(
            juce_plugin_ids(&hex16("01EFCDAB8291EBFA4D616E754232626D")).0,
            0xef66d422
        ); // EQ
        assert_eq!(
            juce_plugin_ids(&hex16("01EFCDAB8291EBFA4D616E75466C7665")).0,
            0xf3a0e81a
        ); // De-Esser
        assert_eq!(
            juce_plugin_ids(&hex16("01EFCDAB8291EBFA4D616E7549307A6A")).0,
            0xf664ec1f
        ); // Compressor
    }

    #[test]
    fn plugin_id_hash_on_synthetic_ids() {
        assert_eq!(juce_plugin_ids(&[0u8; 16]), (0, 0));
        // longs = [1, 0, 0, 0] → ((1*31)*31)*31 = 29791; chars: 1 then 15 zeros → 31^15 (wrapping)
        let mut cid = [0u8; 16];
        cid[0] = 1;
        let dep = (0..15).fold(1u32, |h, _| h.wrapping_mul(31));
        assert_eq!(juce_plugin_ids(&cid), (29_791, dep));
        // byte 4 is the low byte of the high half of long 2
        let mut cid = [0u8; 16];
        cid[4] = 1;
        assert_eq!(fuid_longs(&cid), [0, 0x0001_0000, 0, 0]);
    }
}
