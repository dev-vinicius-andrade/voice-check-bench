// Shared-memory ring buffer interface between the kernel-mode virtual capture endpoint
// and the user-mode audio processing service. Both sides include this header; the kernel
// side uses it under WDK (no CRT), the user side under MSVC/Rust FFI.
//
// Layout: a fixed-size named shared memory section containing this header followed by
// a circular buffer of float32 samples. The writer (user-mode service) writes processed
// mono blocks; the reader (kernel capture endpoint) reads them out to WASAPI consumers.
//
// Synchronization: two event handles (write-ready, read-ready) plus atomic head/tail
// indices. No mutexes — single-writer/single-reader lock-free design.

#ifndef VCB_RING_H
#define VCB_RING_H

#ifdef _KERNEL_MODE
#include <ntddk.h>
typedef LONG VCB_ATOMIC;
#define VCB_ATOMIC_LOAD(x) InterlockedCompareExchange(&(x), 0, 0)
#define VCB_ATOMIC_STORE(x, v) InterlockedExchange(&(x), (v))
#else
#include <stdint.h>
#include <windows.h>
typedef volatile LONG VCB_ATOMIC;
#define VCB_ATOMIC_LOAD(x) InterlockedCompareExchange((LONG*)&(x), 0, 0)
#define VCB_ATOMIC_STORE(x, v) InterlockedExchange((LONG*)&(x), (v))
#endif

// Must match the audio engine's fixed format (host::SAMPLE_RATE, host::BLOCK).
#define VCB_SAMPLE_RATE     48000
#define VCB_BLOCK_SAMPLES   480
#define VCB_CHANNELS        1       // mono processing, duplicated at render
#define VCB_BYTES_PER_SAMPLE sizeof(float)

// Ring capacity in blocks. 64 blocks = ~1.3 seconds at 48kHz/480.
// Large enough to absorb scheduling jitter without excessive latency.
#define VCB_RING_BLOCKS     64
#define VCB_RING_SAMPLES    (VCB_RING_BLOCKS * VCB_BLOCK_SAMPLES)
#define VCB_RING_BYTES      (VCB_RING_SAMPLES * VCB_BYTES_PER_SAMPLE)

// Named objects (kernel namespace prefix \BaseNamedObjects\ added by creator).
#define VCB_SHM_NAME        L"Global\\VCBAudioRing"
#define VCB_WRITE_EVENT     L"Global\\VCBWriteReady"
#define VCB_READ_EVENT      L"Global\\VCBReadReady"

// Header lives at the start of the shared memory section, followed by the sample buffer.
#pragma pack(push, 4)
typedef struct _VCB_RING_HEADER {
    // Monotonically increasing write position in samples (wraps at UINT32_MAX).
    // Actual buffer index = writePos % VCB_RING_SAMPLES.
    VCB_ATOMIC writePos;

    // Monotonically increasing read position in samples (wraps at UINT32_MAX).
    // Actual buffer index = readPos % VCB_RING_SAMPLES.
    VCB_ATOMIC readPos;

    // Set to 1 when the user-mode service is actively writing; 0 on shutdown.
    // Kernel endpoint returns silence when this is 0.
    VCB_ATOMIC active;

    // Format confirmation (written once at init, read-only after).
    unsigned int sampleRate;
    unsigned int blockSamples;
    unsigned int channels;

    // Reserved for future use (version, flags).
    unsigned int reserved[4];
} VCB_RING_HEADER;
#pragma pack(pop)

// Total shared memory size: header + sample buffer.
#define VCB_SHM_SIZE (sizeof(VCB_RING_HEADER) + VCB_RING_BYTES)

// Pointer to sample buffer given header pointer.
#define VCB_RING_BUFFER(hdr) ((float*)((char*)(hdr) + sizeof(VCB_RING_HEADER)))

// Number of samples available to read (writer ahead of reader).
static inline unsigned int vcb_ring_readable(const VCB_RING_HEADER* hdr) {
    unsigned int w = (unsigned int)VCB_ATOMIC_LOAD(hdr->writePos);
    unsigned int r = (unsigned int)VCB_ATOMIC_LOAD(hdr->readPos);
    return w - r;  // unsigned wraparound gives correct distance
}

// Number of samples of free space available to write.
static inline unsigned int vcb_ring_writable(const VCB_RING_HEADER* hdr) {
    return VCB_RING_SAMPLES - vcb_ring_readable(hdr);
}

#endif // VCB_RING_H