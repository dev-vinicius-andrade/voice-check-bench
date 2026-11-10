//! Host-side COM objects: IHostApplication, IComponentHandler, IBStream (memory), IMessage, IAttributeList.
//! Every callback the plugin makes into the host is logged to stderr with a `[host]` prefix.

use std::collections::HashMap;
use std::ffi::{c_void, CStr, CString};
use std::sync::Mutex;

use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;
use vst3::{Class, ComWrapper, Interface};

pub fn tuid_hex(t: &TUID) -> String {
    t.iter().map(|b| format!("{:02X}", *b as u8)).collect()
}

pub fn tuid_guid(t: TUID) -> [u8; 16] {
    t.map(|b| b as u8)
}

pub fn iid_name(t: &TUID) -> &'static str {
    let g = tuid_guid(*t);
    if g == IMessage::IID {
        "IMessage"
    } else if g == IAttributeList::IID {
        "IAttributeList"
    } else if g == IBStream::IID {
        "IBStream"
    } else {
        "?"
    }
}

pub fn write_string128(src: &str, dst: &mut String128) {
    let mut n = 0;
    for (s, d) in src.encode_utf16().zip(dst.iter_mut()) {
        *d = s;
        n += 1;
    }
    let last = dst.len() - 1;
    dst[n.min(last)] = 0;
}

pub fn read_string128(s: &[TChar]) -> String {
    let len = s.iter().position(|c| *c == 0).unwrap_or(s.len());
    String::from_utf16_lossy(&s[..len])
}

pub fn read_cstr(s: &[std::ffi::c_char]) -> String {
    let bytes: Vec<u8> = s.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

// ------------------------------------------------------------------ IHostApplication

pub struct HostApp {
    pub name: String,
}

impl Class for HostApp {
    type Interfaces = (IHostApplication,);
}

impl IHostApplicationTrait for HostApp {
    unsafe fn getName(&self, name: *mut String128) -> tresult {
        eprintln!("[host] IHostApplication::getName -> {:?}", self.name);
        if name.is_null() {
            return kInvalidArgument;
        }
        unsafe { write_string128(&self.name, &mut *name) };
        kResultOk
    }

    unsafe fn createInstance(&self, cid: *mut TUID, iid: *mut TUID, obj: *mut *mut c_void) -> tresult {
        if cid.is_null() || iid.is_null() || obj.is_null() {
            return kInvalidArgument;
        }
        let (cid, iid) = unsafe { (*cid, *iid) };
        eprintln!("[host] IHostApplication::createInstance cid={} ({}) iid={}", tuid_hex(&cid), iid_name(&cid), tuid_hex(&iid));
        let g = tuid_guid(cid);
        let gi = tuid_guid(iid);
        unsafe {
            if g == IMessage::IID && gi == IMessage::IID {
                let m = ComWrapper::new(HostMessage::default());
                *obj = m.to_com_ptr::<IMessage>().unwrap().into_raw() as *mut c_void;
                return kResultOk;
            }
            if g == IAttributeList::IID && gi == IAttributeList::IID {
                let a = ComWrapper::new(AttrList::default());
                *obj = a.to_com_ptr::<IAttributeList>().unwrap().into_raw() as *mut c_void;
                return kResultOk;
            }
            *obj = std::ptr::null_mut();
        }
        kNoInterface
    }
}

// ------------------------------------------------------------------ IComponentHandler

#[derive(Default)]
pub struct ComponentHandler {
    pub edits: Mutex<Vec<(u32, f64)>>,
    pub restarts: Mutex<Vec<i32>>,
}

impl Class for ComponentHandler {
    type Interfaces = (IComponentHandler,);
}

impl IComponentHandlerTrait for ComponentHandler {
    unsafe fn beginEdit(&self, _id: ParamID) -> tresult {
        kResultOk
    }
    unsafe fn performEdit(&self, id: ParamID, v: ParamValue) -> tresult {
        eprintln!("[host] IComponentHandler::performEdit id={id} value={v}");
        self.edits.lock().unwrap().push((id, v));
        kResultOk
    }
    unsafe fn endEdit(&self, _id: ParamID) -> tresult {
        kResultOk
    }
    unsafe fn restartComponent(&self, flags: int32) -> tresult {
        eprintln!("[host] IComponentHandler::restartComponent flags=0x{flags:X}");
        self.restarts.lock().unwrap().push(flags);
        kResultOk
    }
}

// ------------------------------------------------------------------ IBStream over a Vec<u8>

#[derive(Default)]
pub struct MemStream {
    inner: Mutex<(Vec<u8>, usize)>,
}

impl MemStream {
    pub fn from_bytes(b: &[u8]) -> Self {
        MemStream { inner: Mutex::new((b.to_vec(), 0)) }
    }
    pub fn bytes(&self) -> Vec<u8> {
        self.inner.lock().unwrap().0.clone()
    }
}

impl Class for MemStream {
    type Interfaces = (IBStream,);
}

impl IBStreamTrait for MemStream {
    unsafe fn read(&self, buffer: *mut c_void, num: int32, read: *mut int32) -> tresult {
        let mut g = self.inner.lock().unwrap();
        let (data, pos) = &mut *g;
        let avail = data.len().saturating_sub(*pos);
        let n = (num.max(0) as usize).min(avail);
        if n > 0 && !buffer.is_null() {
            unsafe { std::ptr::copy_nonoverlapping(data.as_ptr().add(*pos), buffer as *mut u8, n) };
        }
        *pos += n;
        if !read.is_null() {
            unsafe { *read = n as int32 };
        }
        kResultOk
    }
    unsafe fn write(&self, buffer: *mut c_void, num: int32, written: *mut int32) -> tresult {
        let mut g = self.inner.lock().unwrap();
        let (data, pos) = &mut *g;
        let n = num.max(0) as usize;
        if data.len() < *pos + n {
            data.resize(*pos + n, 0);
        }
        if n > 0 && !buffer.is_null() {
            unsafe { std::ptr::copy_nonoverlapping(buffer as *const u8, data.as_mut_ptr().add(*pos), n) };
        }
        *pos += n;
        if !written.is_null() {
            unsafe { *written = n as int32 };
        }
        kResultOk
    }
    unsafe fn seek(&self, pos: int64, mode: int32, result: *mut int64) -> tresult {
        let mut g = self.inner.lock().unwrap();
        let (data, p) = &mut *g;
        let base: i64 = match mode as IBStream_::IStreamSeekMode {
            IBStream_::IStreamSeekMode_::kIBSeekSet => 0,
            IBStream_::IStreamSeekMode_::kIBSeekCur => *p as i64,
            IBStream_::IStreamSeekMode_::kIBSeekEnd => data.len() as i64,
            _ => return kInvalidArgument,
        };
        let np = (base + pos).max(0) as usize;
        *p = np;
        if !result.is_null() {
            unsafe { *result = np as int64 };
        }
        kResultOk
    }
    unsafe fn tell(&self, pos: *mut int64) -> tresult {
        if !pos.is_null() {
            unsafe { *pos = self.inner.lock().unwrap().1 as int64 };
        }
        kResultOk
    }
}

// ------------------------------------------------------------------ IMessage / IAttributeList

#[derive(Clone)]
enum Attr {
    Int(i64),
    Float(f64),
    Str(Vec<u16>),
    Bin(Vec<u8>),
}

#[derive(Default)]
pub struct AttrList {
    map: Mutex<HashMap<String, Attr>>,
}

impl Class for AttrList {
    type Interfaces = (IAttributeList,);
}

unsafe fn key(id: IAttributeList_::AttrID) -> String {
    if id.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(id) }.to_string_lossy().into_owned()
}

impl IAttributeListTrait for AttrList {
    unsafe fn setInt(&self, id: IAttributeList_::AttrID, value: int64) -> tresult {
        self.map.lock().unwrap().insert(unsafe { key(id) }, Attr::Int(value));
        kResultOk
    }
    unsafe fn getInt(&self, id: IAttributeList_::AttrID, value: *mut int64) -> tresult {
        match self.map.lock().unwrap().get(&unsafe { key(id) }) {
            Some(Attr::Int(v)) => {
                unsafe { *value = *v };
                kResultOk
            }
            _ => kResultFalse,
        }
    }
    unsafe fn setFloat(&self, id: IAttributeList_::AttrID, value: f64) -> tresult {
        self.map.lock().unwrap().insert(unsafe { key(id) }, Attr::Float(value));
        kResultOk
    }
    unsafe fn getFloat(&self, id: IAttributeList_::AttrID, value: *mut f64) -> tresult {
        match self.map.lock().unwrap().get(&unsafe { key(id) }) {
            Some(Attr::Float(v)) => {
                unsafe { *value = *v };
                kResultOk
            }
            _ => kResultFalse,
        }
    }
    unsafe fn setString(&self, id: IAttributeList_::AttrID, s: *const TChar) -> tresult {
        let mut v = Vec::new();
        if !s.is_null() {
            let mut i = 0;
            loop {
                let c = unsafe { *s.add(i) };
                if c == 0 {
                    break;
                }
                v.push(c);
                i += 1;
            }
        }
        self.map.lock().unwrap().insert(unsafe { key(id) }, Attr::Str(v));
        kResultOk
    }
    unsafe fn getString(&self, id: IAttributeList_::AttrID, s: *mut TChar, size_bytes: uint32) -> tresult {
        match self.map.lock().unwrap().get(&unsafe { key(id) }) {
            Some(Attr::Str(v)) => {
                let cap = (size_bytes as usize / 2).saturating_sub(1);
                let n = v.len().min(cap);
                unsafe {
                    std::ptr::copy_nonoverlapping(v.as_ptr(), s, n);
                    *s.add(n) = 0;
                }
                kResultOk
            }
            _ => kResultFalse,
        }
    }
    unsafe fn setBinary(&self, id: IAttributeList_::AttrID, data: *const c_void, size: uint32) -> tresult {
        let b = if data.is_null() { vec![] } else { unsafe { std::slice::from_raw_parts(data as *const u8, size as usize) }.to_vec() };
        self.map.lock().unwrap().insert(unsafe { key(id) }, Attr::Bin(b));
        kResultOk
    }
    unsafe fn getBinary(&self, id: IAttributeList_::AttrID, data: *mut *const c_void, size: *mut uint32) -> tresult {
        // The pointer must stay valid while the list lives: the Vec is owned by the map entry.
        let g = self.map.lock().unwrap();
        match g.get(&unsafe { key(id) }) {
            Some(Attr::Bin(v)) => {
                unsafe {
                    *data = v.as_ptr() as *const c_void;
                    *size = v.len() as uint32;
                }
                kResultOk
            }
            _ => kResultFalse,
        }
    }
}

pub struct HostMessage {
    id: Mutex<CString>,
    attrs: ComWrapper<AttrList>,
}

impl Default for HostMessage {
    fn default() -> Self {
        HostMessage { id: Mutex::new(CString::default()), attrs: ComWrapper::new(AttrList::default()) }
    }
}

impl Class for HostMessage {
    type Interfaces = (IMessage,);
}

impl IMessageTrait for HostMessage {
    unsafe fn getMessageID(&self) -> FIDString {
        self.id.lock().unwrap().as_ptr()
    }
    unsafe fn setMessageID(&self, id: FIDString) {
        let s = if id.is_null() { CString::default() } else { unsafe { CStr::from_ptr(id) }.to_owned() };
        eprintln!("[host] IMessage::setMessageID {:?}", s);
        *self.id.lock().unwrap() = s;
    }
    unsafe fn getAttributes(&self) -> *mut IAttributeList {
        // Borrowed pointer (no AddRef), as in the SDK's HostMessage.
        self.attrs.as_com_ref::<IAttributeList>().unwrap().as_ptr()
    }
}

// ------------------------------------------------------------------ IParameterChanges (one point per param, offset 0)

pub struct ParamQueue {
    id: ParamID,
    value: ParamValue,
}

impl Class for ParamQueue {
    type Interfaces = (IParamValueQueue,);
}

impl IParamValueQueueTrait for ParamQueue {
    unsafe fn getParameterId(&self) -> ParamID {
        self.id
    }
    unsafe fn getPointCount(&self) -> int32 {
        1
    }
    unsafe fn getPoint(&self, index: int32, offset: *mut int32, value: *mut ParamValue) -> tresult {
        if index != 0 {
            return kInvalidArgument;
        }
        unsafe {
            *offset = 0;
            *value = self.value;
        }
        kResultOk
    }
    unsafe fn addPoint(&self, _o: int32, _v: ParamValue, _i: *mut int32) -> tresult {
        kResultFalse
    }
}

pub struct ParamChanges {
    queues: Vec<ComWrapper<ParamQueue>>,
}

impl ParamChanges {
    pub fn new(changes: &[(u32, f64)]) -> Self {
        ParamChanges { queues: changes.iter().map(|(id, v)| ComWrapper::new(ParamQueue { id: *id, value: *v })).collect() }
    }
}

impl Class for ParamChanges {
    type Interfaces = (IParameterChanges,);
}

impl IParameterChangesTrait for ParamChanges {
    unsafe fn getParameterCount(&self) -> int32 {
        self.queues.len() as int32
    }
    unsafe fn getParameterData(&self, index: int32) -> *mut IParamValueQueue {
        match self.queues.get(index as usize) {
            Some(q) => q.as_com_ref::<IParamValueQueue>().unwrap().as_ptr(),
            None => std::ptr::null_mut(),
        }
    }
    unsafe fn addParameterData(&self, _id: *const ParamID, _index: *mut int32) -> *mut IParamValueQueue {
        std::ptr::null_mut()
    }
}
