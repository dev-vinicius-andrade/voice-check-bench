//! The plugin host thread: one per process, owns the Win32 message loop (JUCE message thread) and runs control jobs.
//! See the threading model in `host/mod.rs`.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::thread::ThreadId;
use std::time::Duration;

use super::{HostError, HostResult};

/// How long the loop waits for a job before pumping messages again.
const PUMP_INTERVAL: Duration = Duration::from_millis(4);

type Job = Box<dyn FnOnce() + Send + 'static>;

pub struct HostThread {
    tx: Sender<Job>,
    id: ThreadId,
}

static HOST: OnceLock<HostThread> = OnceLock::new();

/// The process-wide host thread, started on first use. It is never stopped: JUCE plugins keep their message
/// thread for the life of the process.
pub fn host() -> &'static HostThread {
    HOST.get_or_init(HostThread::spawn)
}

/// True when the caller runs on the host thread (false before it was started).
pub fn is_host_thread() -> bool {
    HOST.get().is_some_and(HostThread::is_current)
}

impl HostThread {
    fn spawn() -> HostThread {
        let (tx, rx) = mpsc::channel::<Job>();
        let (id_tx, id_rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("vcb-plugin-host".into())
            .spawn(move || {
                win::ole_initialize();
                let _ = id_tx.send(std::thread::current().id());
                loop {
                    win::pump_messages();
                    match rx.recv_timeout(PUMP_INTERVAL) {
                        // A panicking job must not take the message thread (and every plugin on it) down.
                        Ok(job) => {
                            let _ = catch_unwind(AssertUnwindSafe(job));
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .expect("spawn plugin host thread");
        let id = id_rx.recv().expect("plugin host thread started");
        HostThread { tx, id }
    }

    pub fn is_current(&self) -> bool {
        std::thread::current().id() == self.id
    }

    /// Run `f` on the host thread and wait for its result. Runs inline when already on the host thread.
    /// Not real-time safe.
    pub fn run<R, F>(&self, f: F) -> HostResult<R>
    where
        R: Send + 'static,
        F: FnOnce() -> R + Send + 'static,
    {
        if self.is_current() {
            return Ok(f());
        }
        let (rtx, rrx) = mpsc::sync_channel(1);
        self.tx
            .send(Box::new(move || {
                let _ = rtx.send(f());
            }))
            .map_err(|_| HostError::from("plugin host thread is gone"))?;
        rrx.recv()
            .map_err(|_| HostError::from("plugin host job panicked"))
    }
}

/// Dispatch pending window messages on the calling thread (JUCE plugins post async updates to a hidden window).
pub fn pump_messages() -> usize {
    win::pump_messages()
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

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

    pub fn ole_initialize() {
        // S_FALSE (already initialized) is fine; a failure only matters for plugin editors (task 39+).
        unsafe { OleInitialize(std::ptr::null_mut()) };
    }

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
}

#[cfg(not(windows))]
mod win {
    pub fn ole_initialize() {}
    pub fn pump_messages() -> usize {
        0
    }
}
