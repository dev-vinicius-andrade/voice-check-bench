// User-mode side of the virtual audio cable: creates the named shared memory section
// and writes processed mono blocks to the ring buffer for the kernel capture endpoint.
// This module is Windows-only; on other platforms it compiles as a no-op stub.
//
// The kernel driver (src-driver/minwavert.cpp) opens this section by name and reads
// from it in its capture callback. When active==0 or the ring underruns, the driver
// returns silence.

#[cfg(windows)]
mod inner {
    use std::mem;
    use std::ptr;
    use std::sync::atomic::{AtomicU32, Ordering};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Memory::{
        CreateFileMappingW, MapViewOfFile, UnmapViewOfFile, MEMORY_MAPPED_VIEW_ADDRESS,
        FILE_MAP_ALL_ACCESS, PAGE_READWRITE,
    };
    use windows_sys::Win32::System::Threading::{CreateEventW, SetEvent, ResetEvent};

    // Must match vcb_ring.h exactly — same layout, same constants.
    const SAMPLE_RATE: u32 = 48000;
    const BLOCK_SAMPLES: u32 = 480;
    const CHANNELS: u32 = 1;
    const RING_BLOCKS: u32 = 64;
    const RING_SAMPLES: u32 = RING_BLOCKS * BLOCK_SAMPLES;
    const SHM_NAME: &[u16] = &[
        b'G' as u16, b'l' as u16, b'o' as u16, b'b' as u16, b'a' as u16, b'l' as u16,
        b'\\' as u16,
        b'V' as u16, b'C' as u16, b'B' as u16, b'A' as u16, b'u' as u16, b'd' as u16,
        b'i' as u16, b'o' as u16, b'R' as u16, b'i' as u16, b'n' as u16, b'g' as u16,
        0,
    ];
    const WRITE_EVENT_NAME: &[u16] = &[
        b'G' as u16, b'l' as u16, b'o' as u16, b'b' as u16, b'a' as u16, b'l' as u16,
        b'\\' as u16,
        b'V' as u16, b'C' as u16, b'B' as u16, b'W' as u16, b'r' as u16, b'i' as u16,
        b't' as u16, b'e' as u16, b'R' as u16, b'e' as u16, b'a' as u16, b'd' as u16,
        b'y' as u16,
        0,
    ];

    /// Header layout matching VCB_RING_HEADER in vcb_ring.h.
    /// repr(C) + align(4) ensures identical memory layout to the C struct.
    #[repr(C, align(4))]
    struct RingHeader {
        write_pos: AtomicU32,
        read_pos: AtomicU32,
        active: AtomicU32,
        sample_rate: u32,
        block_samples: u32,
        channels: u32,
        reserved: [u32; 4],
    }

    const HEADER_SIZE: usize = mem::size_of::<RingHeader>();
    const RING_BYTES: usize = (RING_SAMPLES as usize) * mem::size_of::<f32>();
    const SHM_SIZE: usize = HEADER_SIZE + RING_BYTES;

    pub struct VirtualOutput {
        mapping: HANDLE,
        base: *mut u8,
        header: *mut RingHeader,
        write_event: HANDLE,
    }

    unsafe impl Send for VirtualOutput {}
    unsafe impl Sync for VirtualOutput {}

    impl VirtualOutput {
        /// Create the named shared memory section and initialize the header.
        /// Returns None if creation fails (e.g., insufficient privileges).
        pub fn new() -> Option<Self> {
            unsafe {
                let mapping = CreateFileMappingW(
                    INVALID_HANDLE_VALUE,
                    ptr::null(),
                    PAGE_READWRITE,
                    0,
                    SHM_SIZE as u32,
                    SHM_NAME.as_ptr(),
                );
                if mapping.is_null() {
                    return None;
                }

                let mapped = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, SHM_SIZE);
                // MEMORY_MAPPED_VIEW_ADDRESS has a `Value` field that is *mut c_void
                let base_ptr = mapped.Value;
                if base_ptr.is_null() {
                    CloseHandle(mapping);
                    return None;
                }

                let base = base_ptr as *mut u8;

                // Initialize header
                let header = base as *mut RingHeader;
                (*header).write_pos.store(0, Ordering::Release);
                (*header).read_pos.store(0, Ordering::Release);
                (*header).active.store(0, Ordering::Release);
                (*header).sample_rate = SAMPLE_RATE;
                (*header).block_samples = BLOCK_SAMPLES;
                (*header).channels = CHANNELS;
                (*header).reserved = [0; 4];

                let write_event = CreateEventW(ptr::null(), 0, 0, WRITE_EVENT_NAME.as_ptr());

                Some(Self {
                    mapping,
                    base,
                    header,
                    write_event,
                })
            }
        }

        /// Mark the output as active so the kernel driver starts reading.
        pub fn activate(&self) {
            unsafe {
                (*self.header).active.store(1, Ordering::Release);
            }
        }

        /// Mark the output as inactive; kernel driver will return silence.
        pub fn deactivate(&self) {
            unsafe {
                (*self.header).active.store(0, Ordering::Release);
            }
        }

        /// Write a block of processed mono samples to the ring buffer.
        /// Returns false if there isn't enough space (caller should drop or wait).
        pub fn write_block(&self, samples: &[f32]) -> bool {
            debug_assert_eq!(samples.len(), BLOCK_SAMPLES as usize);

            unsafe {
                let writable = RING_SAMPLES
                    - ((*self.header).write_pos.load(Ordering::Acquire)
                        - (*self.header).read_pos.load(Ordering::Acquire));

                if writable < BLOCK_SAMPLES {
                    return false; // ring full, caller must drop or back-pressure
                }

                let write_pos = (*self.header).write_pos.load(Ordering::Acquire);
                let ring_idx = (write_pos % RING_SAMPLES) as usize;
                let ring_buf = self.base.add(HEADER_SIZE) as *mut f32;

                let first_chunk = (RING_SAMPLES as usize) - ring_idx;
                if first_chunk >= samples.len() {
                    // No wrap
                    ptr::copy_nonoverlapping(samples.as_ptr(), ring_buf.add(ring_idx), samples.len());
                } else {
                    // Wrap around
                    ptr::copy_nonoverlapping(samples.as_ptr(), ring_buf.add(ring_idx), first_chunk);
                    ptr::copy_nonoverlapping(
                        samples[first_chunk..].as_ptr(),
                        ring_buf,
                        samples.len() - first_chunk,
                    );
                }

                (*self.header)
                    .write_pos
                    .store(write_pos + BLOCK_SAMPLES, Ordering::Release);

                // Signal kernel that data is available
                if !self.write_event.is_null() {
                    SetEvent(self.write_event);
                }

                true
            }
        }

        /// Number of samples currently buffered (writer ahead of reader).
        pub fn buffered_samples(&self) -> u32 {
            unsafe {
                (*self.header).write_pos.load(Ordering::Acquire)
                    - (*self.header).read_pos.load(Ordering::Acquire)
            }
        }
    }

    impl Drop for VirtualOutput {
        fn drop(&mut self) {
            unsafe {
                self.deactivate();
                if !self.base.is_null() {
                    let addr = MEMORY_MAPPED_VIEW_ADDRESS {
                        Value: self.base as *mut _,
                    };
                    UnmapViewOfFile(addr);
                }
                if !self.mapping.is_null() {
                    CloseHandle(self.mapping);
                }
                if !self.write_event.is_null() {
                    ResetEvent(self.write_event);
                    CloseHandle(self.write_event);
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod inner {
    /// Stub for non-Windows platforms: all operations are no-ops.
    pub struct VirtualOutput;

    impl VirtualOutput {
        pub fn new() -> Option<Self> {
            None
        }
        pub fn activate(&self) {}
        pub fn deactivate(&self) {}
        pub fn write_block(&self, _samples: &[f32]) -> bool {
            false
        }
        pub fn buffered_samples(&self) -> u32 {
            0
        }
    }
}

pub use inner::VirtualOutput;