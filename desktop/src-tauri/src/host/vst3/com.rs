//! Host-side COM objects for VST3: IHostApplication, IComponentHandler, a memory IBStream, IMessage/IAttributeList,
//! and a preallocated, lock-free IParameterChanges for the audio thread. Port of `spike/vst3-probe/src/com.rs`.

use std::collections::HashMap;
use std::ffi::{c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;
use vst3::{Class, ComWrapper, Interface};

fn guid(t: TUID) -> [u8; 16] {
    t.map(|b| b as u8)
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
    let bytes: Vec<u8> = s
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
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
        if name.is_null() {
            return kInvalidArgument;
        }
        unsafe { write_string128(&self.name, &mut *name) };
        kResultOk
    }

    unsafe fn createInstance(
        &self,
        cid: *mut TUID,
        iid: *mut TUID,
        obj: *mut *mut c_void,
    ) -> tresult {
        if cid.is_null() || iid.is_null() || obj.is_null() {
            return kInvalidArgument;
        }
        let (cid, iid) = unsafe { (guid(*cid), guid(*iid)) };
        unsafe {
            if cid == IMessage::IID && iid == IMessage::IID {
                let m = ComWrapper::new(HostMessage::default());
                if let Some(p) = m.to_com_ptr::<IMessage>() {
                    *obj = p.into_raw() as *mut c_void;
                    return kResultOk;
                }
            }
            if cid == IAttributeList::IID && iid == IAttributeList::IID {
                let a = ComWrapper::new(AttrList::default());
                if let Some(p) = a.to_com_ptr::<IAttributeList>() {
                    *obj = p.into_raw() as *mut c_void;
                    return kResultOk;
                }
            }
            *obj = std::ptr::null_mut();
        }
        kNoInterface
    }
}

// ------------------------------------------------------------------ parameter mailbox (host → audio thread)

struct MailEntry {
    id: u32,
    value: AtomicU64,
    dirty: AtomicBool,
}

/// Latest-value-wins parameter changes waiting for the processor. Fixed size (one entry per parameter id), so posting
/// and draining never allocate; draining is real-time safe.
pub struct ParamMailbox {
    entries: Vec<MailEntry>,
}

impl ParamMailbox {
    pub fn new(ids: impl IntoIterator<Item = u32>) -> Self {
        ParamMailbox {
            entries: ids
                .into_iter()
                .map(|id| MailEntry {
                    id,
                    value: AtomicU64::new(0),
                    dirty: AtomicBool::new(false),
                })
                .collect(),
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Queue `value` for parameter `id`; false when the id is unknown.
    pub fn post(&self, id: u32, value: f64) -> bool {
        match self.entries.iter().find(|e| e.id == id) {
            Some(e) => {
                e.value.store(value.to_bits(), Ordering::Relaxed);
                e.dirty.store(true, Ordering::Release);
                true
            }
            None => false,
        }
    }

    /// Drop every pending change (after a state load, so stale values do not override the loaded state).
    pub fn clear(&self) {
        for e in &self.entries {
            e.dirty.store(false, Ordering::Release);
        }
    }

    pub fn drain(&self, mut f: impl FnMut(u32, f64)) {
        for e in &self.entries {
            if e.dirty.swap(false, Ordering::Acquire) {
                f(e.id, f64::from_bits(e.value.load(Ordering::Relaxed)));
            }
        }
    }
}

// ------------------------------------------------------------------ IComponentHandler

/// Edits made in the plugin's own editor (performEdit) go to the processor through the mailbox, like a DAW does.
#[derive(Default)]
pub struct ComponentHandler {
    pub mailbox: OnceLock<Arc<ParamMailbox>>,
    pub last_restart_flags: AtomicI32,
}

impl Class for ComponentHandler {
    type Interfaces = (IComponentHandler,);
}

impl IComponentHandlerTrait for ComponentHandler {
    unsafe fn beginEdit(&self, _id: ParamID) -> tresult {
        kResultOk
    }
    unsafe fn performEdit(&self, id: ParamID, v: ParamValue) -> tresult {
        if let Some(m) = self.mailbox.get() {
            m.post(id, v);
        }
        kResultOk
    }
    unsafe fn endEdit(&self, _id: ParamID) -> tresult {
        kResultOk
    }
    unsafe fn restartComponent(&self, flags: int32) -> tresult {
        self.last_restart_flags.store(flags, Ordering::Relaxed);
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
        MemStream {
            inner: Mutex::new((b.to_vec(), 0)),
        }
    }
    pub fn bytes(&self) -> Vec<u8> {
        self.inner.lock().map(|g| g.0.clone()).unwrap_or_default()
    }
}

impl Class for MemStream {
    type Interfaces = (IBStream,);
}

impl IBStreamTrait for MemStream {
    unsafe fn read(&self, buffer: *mut c_void, num: int32, read: *mut int32) -> tresult {
        let Ok(mut g) = self.inner.lock() else {
            return kInternalError;
        };
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
        let Ok(mut g) = self.inner.lock() else {
            return kInternalError;
        };
        let (data, pos) = &mut *g;
        let n = num.max(0) as usize;
        if data.len() < *pos + n {
            data.resize(*pos + n, 0);
        }
        if n > 0 && !buffer.is_null() {
            unsafe {
                std::ptr::copy_nonoverlapping(buffer as *const u8, data.as_mut_ptr().add(*pos), n)
            };
        }
        *pos += n;
        if !written.is_null() {
            unsafe { *written = n as int32 };
        }
        kResultOk
    }
    unsafe fn seek(&self, pos: int64, mode: int32, result: *mut int64) -> tresult {
        let Ok(mut g) = self.inner.lock() else {
            return kInternalError;
        };
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
        let Ok(g) = self.inner.lock() else {
            return kInternalError;
        };
        if !pos.is_null() {
            unsafe { *pos = g.1 as int64 };
        }
        kResultOk
    }
}

// ------------------------------------------------------------------ IMessage / IAttributeList

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

impl AttrList {
    fn set(&self, id: IAttributeList_::AttrID, a: Attr) -> tresult {
        match self.map.lock() {
            Ok(mut m) => {
                m.insert(unsafe { key(id) }, a);
                kResultOk
            }
            Err(_) => kInternalError,
        }
    }
}

impl IAttributeListTrait for AttrList {
    unsafe fn setInt(&self, id: IAttributeList_::AttrID, value: int64) -> tresult {
        self.set(id, Attr::Int(value))
    }
    unsafe fn getInt(&self, id: IAttributeList_::AttrID, value: *mut int64) -> tresult {
        let Ok(m) = self.map.lock() else {
            return kInternalError;
        };
        match m.get(&unsafe { key(id) }) {
            Some(Attr::Int(v)) if !value.is_null() => {
                unsafe { *value = *v };
                kResultOk
            }
            _ => kResultFalse,
        }
    }
    unsafe fn setFloat(&self, id: IAttributeList_::AttrID, value: f64) -> tresult {
        self.set(id, Attr::Float(value))
    }
    unsafe fn getFloat(&self, id: IAttributeList_::AttrID, value: *mut f64) -> tresult {
        let Ok(m) = self.map.lock() else {
            return kInternalError;
        };
        match m.get(&unsafe { key(id) }) {
            Some(Attr::Float(v)) if !value.is_null() => {
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
        self.set(id, Attr::Str(v))
    }
    unsafe fn getString(
        &self,
        id: IAttributeList_::AttrID,
        s: *mut TChar,
        size_bytes: uint32,
    ) -> tresult {
        let Ok(m) = self.map.lock() else {
            return kInternalError;
        };
        match m.get(&unsafe { key(id) }) {
            Some(Attr::Str(v)) if !s.is_null() && size_bytes >= 2 => {
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
    unsafe fn setBinary(
        &self,
        id: IAttributeList_::AttrID,
        data: *const c_void,
        size: uint32,
    ) -> tresult {
        let b = if data.is_null() {
            vec![]
        } else {
            unsafe { std::slice::from_raw_parts(data as *const u8, size as usize) }.to_vec()
        };
        self.set(id, Attr::Bin(b))
    }
    unsafe fn getBinary(
        &self,
        id: IAttributeList_::AttrID,
        data: *mut *const c_void,
        size: *mut uint32,
    ) -> tresult {
        // The pointer stays valid while the list lives: the Vec is owned by the map entry.
        let Ok(m) = self.map.lock() else {
            return kInternalError;
        };
        match m.get(&unsafe { key(id) }) {
            Some(Attr::Bin(v)) if !data.is_null() && !size.is_null() => {
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
        HostMessage {
            id: Mutex::new(CString::default()),
            attrs: ComWrapper::new(AttrList::default()),
        }
    }
}

impl Class for HostMessage {
    type Interfaces = (IMessage,);
}

impl IMessageTrait for HostMessage {
    unsafe fn getMessageID(&self) -> FIDString {
        // The CString lives as long as the message; the pointer stays valid until the next setMessageID.
        self.id
            .lock()
            .map(|g| g.as_ptr())
            .unwrap_or(std::ptr::null())
    }
    unsafe fn setMessageID(&self, id: FIDString) {
        let s = if id.is_null() {
            CString::default()
        } else {
            unsafe { CStr::from_ptr(id) }.to_owned()
        };
        if let Ok(mut g) = self.id.lock() {
            *g = s;
        }
    }
    unsafe fn getAttributes(&self) -> *mut IAttributeList {
        // Borrowed pointer (no AddRef), as in the SDK's HostMessage.
        self.attrs
            .as_com_ref::<IAttributeList>()
            .map(|r| r.as_ptr())
            .unwrap_or(std::ptr::null_mut())
    }
}

// ------------------------------------------------------------------ IParameterChanges for the audio thread

/// One parameter, one point at sample offset 0.
pub struct RtQueue {
    id: AtomicU32,
    value: AtomicU64,
}

impl Class for RtQueue {
    type Interfaces = (IParamValueQueue,);
}

impl IParamValueQueueTrait for RtQueue {
    unsafe fn getParameterId(&self) -> ParamID {
        self.id.load(Ordering::Relaxed)
    }
    unsafe fn getPointCount(&self) -> int32 {
        1
    }
    unsafe fn getPoint(&self, index: int32, offset: *mut int32, value: *mut ParamValue) -> tresult {
        if index != 0 || offset.is_null() || value.is_null() {
            return kInvalidArgument;
        }
        unsafe {
            *offset = 0;
            *value = f64::from_bits(self.value.load(Ordering::Relaxed));
        }
        kResultOk
    }
    unsafe fn addPoint(&self, _o: int32, _v: ParamValue, _i: *mut int32) -> tresult {
        kResultFalse
    }
}

/// Preallocated input parameter changes: refilled from the mailbox before each block without allocating.
pub struct RtChanges {
    queues: Vec<ComWrapper<RtQueue>>,
    count: AtomicI32,
}

impl RtChanges {
    pub fn with_capacity(n: usize) -> Self {
        RtChanges {
            queues: (0..n)
                .map(|_| {
                    ComWrapper::new(RtQueue {
                        id: AtomicU32::new(0),
                        value: AtomicU64::new(0),
                    })
                })
                .collect(),
            count: AtomicI32::new(0),
        }
    }

    /// Move pending mailbox changes into the queues; returns how many there are. Real-time safe.
    pub fn fill(&self, mailbox: &ParamMailbox) -> i32 {
        let mut n = 0usize;
        let queues = &self.queues;
        mailbox.drain(|id, v| {
            if let Some(q) = queues.get(n) {
                q.id.store(id, Ordering::Relaxed);
                q.value.store(v.to_bits(), Ordering::Relaxed);
                n += 1;
            }
        });
        self.count.store(n as i32, Ordering::Relaxed);
        n as i32
    }
}

impl Class for RtChanges {
    type Interfaces = (IParameterChanges,);
}

impl IParameterChangesTrait for RtChanges {
    unsafe fn getParameterCount(&self) -> int32 {
        self.count.load(Ordering::Relaxed)
    }
    unsafe fn getParameterData(&self, index: int32) -> *mut IParamValueQueue {
        if index < 0 || index >= self.count.load(Ordering::Relaxed) {
            return std::ptr::null_mut();
        }
        match self
            .queues
            .get(index as usize)
            .and_then(|q| q.as_com_ref::<IParamValueQueue>())
        {
            Some(r) => r.as_ptr(),
            None => std::ptr::null_mut(),
        }
    }
    unsafe fn addParameterData(
        &self,
        _id: *const ParamID,
        _index: *mut int32,
    ) -> *mut IParamValueQueue {
        std::ptr::null_mut()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mailbox_keeps_latest_value_and_drains_once() {
        let m = ParamMailbox::new([10, 20, 30]);
        assert!(m.post(20, 0.25));
        assert!(m.post(20, 0.75));
        assert!(m.post(10, 1.0));
        assert!(!m.post(99, 0.5), "unknown id");
        let mut got = vec![];
        m.drain(|id, v| got.push((id, v)));
        assert_eq!(got, vec![(10, 1.0), (20, 0.75)]);
        let mut again = 0;
        m.drain(|_, _| again += 1);
        assert_eq!(again, 0);
        m.post(30, 0.1);
        m.clear();
        m.drain(|_, _| again += 1);
        assert_eq!(again, 0, "cleared");
    }

    #[test]
    fn rt_changes_expose_pending_points() {
        let m = ParamMailbox::new([1, 2]);
        let c = RtChanges::with_capacity(m.len());
        m.post(2, 0.5);
        assert_eq!(c.fill(&m), 1);
        unsafe {
            assert_eq!(c.getParameterCount(), 1);
            let q = c.getParameterData(0);
            assert!(!q.is_null());
            assert!(c.getParameterData(1).is_null());
        }
        let q = &c.queues[0];
        let (mut off, mut v) = (7, 0.0);
        unsafe {
            assert_eq!(q.getParameterId(), 2);
            assert_eq!(q.getPoint(0, &mut off, &mut v), kResultOk);
        }
        assert_eq!((off, v), (0, 0.5));
        assert_eq!(c.fill(&m), 0);
    }
}
