// VCB Virtual Audio Capture Endpoint — AVStream miniport prototype.
// Registers a mono 48kHz/32-bit float capture device visible system-wide in Windows Sound.
// Reads processed audio from the user-mode service via the shared-memory ring buffer (vcb_ring.h).
// Returns silence when the service is not active or the ring is underrun.
//
// This is a minimal prototype demonstrating the kernel-user boundary crossing.
// Production version needs: INF installation, WHQL/test signing, proper PnP, power management.

#include <ntddk.h>
#include <portcls.h>
#include <ksmedia.h>
#include "vcb_ring.h"

#pragma code_seg("PAGE")

// ---- Shared memory state (per-device) ----

typedef struct _VCB_DEVICE_CONTEXT {
    HANDLE          shmSection;
    PVOID           shmBase;
    VCB_RING_HEADER* ringHeader;
    HANDLE          readEvent;
    BOOLEAN         initialized;
} VCB_DEVICE_CONTEXT;

// ---- Ring buffer reader helpers ----

static void VcbReadFromRing(
    VCB_DEVICE_CONTEXT* ctx,
    float* destBuffer,
    ULONG sampleCount)
{
    if (!ctx->initialized || !ctx->ringHeader) {
        RtlZeroMemory(destBuffer, sampleCount * sizeof(float));
        return;
    }

    // Check if user-mode service is active
    if (VCB_ATOMIC_LOAD(ctx->ringHeader->active) == 0) {
        RtlZeroMemory(destBuffer, sampleCount * sizeof(float));
        return;
    }

    unsigned int readable = vcb_ring_readable(ctx->ringHeader);
    float* ringBuf = VCB_RING_BUFFER(ctx->ringHeader);

    if (readable >= sampleCount) {
        // Enough data available — copy with wraparound handling
        unsigned int r = (unsigned int)VCB_ATOMIC_LOAD(ctx->ringHeader->readPos);
        unsigned int ringIdx = r % VCB_RING_SAMPLES;
        unsigned int firstChunk = VCB_RING_SAMPLES - ringIdx;

        if (firstChunk >= sampleCount) {
            // No wrap needed
            RtlCopyMemory(destBuffer, &ringBuf[ringIdx], sampleCount * sizeof(float));
        } else {
            // Wrap around the ring
            RtlCopyMemory(destBuffer, &ringBuf[ringIdx], firstChunk * sizeof(float));
            RtlCopyMemory(&destBuffer[firstChunk], &ringBuf[0],
                         (sampleCount - firstChunk) * sizeof(float));
        }

        // Advance read position atomically
        VCB_ATOMIC_STORE(ctx->ringHeader->readPos, r + sampleCount);
    } else {
        // Underrun — fill with silence and don't advance read pointer
        // The user-mode service will catch up on next write cycle
        RtlZeroMemory(destBuffer, sampleCount * sizeof(float));
    }
}

// ---- Shared memory initialization ----

static NTSTATUS VcbInitSharedMemory(VCB_DEVICE_CONTEXT* ctx)
{
    UNICODE_STRING shmName;
    OBJECT_ATTRIBUTES oa;
    LARGE_INTEGER sectionSize;

    PAGED_CODE();

    RtlInitUnicodeString(&shmName, VCB_SHM_NAME);
    InitializeObjectAttributes(&oa, &shmName, OBJ_KERNEL_HANDLE, NULL, NULL);

    sectionSize.QuadPart = VCB_SHM_SIZE;

    // Open existing section created by user-mode service
    NTSTATUS status = ZwOpenSection(&ctx->shmSection, SECTION_MAP_READ | SECTION_MAP_WRITE, &oa);
    if (!NT_SUCCESS(status)) {
        DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_WARNING_LEVEL,
                   "VCB: Failed to open shared memory section: 0x%08X\n", status);
        ctx->initialized = FALSE;
        return status;
    }

    // Map into kernel address space
    SIZE_T viewSize = VCB_SHM_SIZE;
    status = ZwMapViewOfSection(ctx->shmSection, NtCurrentProcess(),
                                &ctx->shmBase, 0, VCB_SHM_SIZE,
                                NULL, &viewSize, ViewUnmap, 0, PAGE_READWRITE);
    if (!NT_SUCCESS(status)) {
        DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_ERROR_LEVEL,
                   "VCB: Failed to map shared memory: 0x%08X\n", status);
        ZwClose(ctx->shmSection);
        ctx->shmSection = NULL;
        ctx->initialized = FALSE;
        return status;
    }

    ctx->ringHeader = (VCB_RING_HEADER*)ctx->shmBase;

    // Validate format matches our expectations
    if (ctx->ringHeader->sampleRate != VCB_SAMPLE_RATE ||
        ctx->ringHeader->blockSamples != VCB_BLOCK_SAMPLES ||
        ctx->ringHeader->channels != VCB_CHANNELS) {
        DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_ERROR_LEVEL,
                   "VCB: Format mismatch in shared memory header\n");
        ZwUnmapViewOfSection(NtCurrentProcess(), ctx->shmBase);
        ZwClose(ctx->shmSection);
        ctx->shmBase = NULL;
        ctx->shmSection = NULL;
        ctx->initialized = FALSE;
        return STATUS_DEVICE_DATA_ERROR;
    }

    ctx->initialized = TRUE;
    DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
               "VCB: Shared memory mapped successfully at %p\n", ctx->shmBase);
    return STATUS_SUCCESS;
}

static void VcbCleanupSharedMemory(VCB_DEVICE_CONTEXT* ctx)
{
    PAGED_CODE();

    if (ctx->shmBase) {
        ZwUnmapViewOfSection(NtCurrentProcess(), ctx->shmBase);
        ctx->shmBase = NULL;
    }
    if (ctx->shmSection) {
        ZwClose(ctx->shmSection);
        ctx->shmSection = NULL;
    }
    ctx->ringHeader = NULL;
    ctx->initialized = FALSE;
}

// ---- WaveCyclic miniport callbacks (prototype stubs) ----

// In production, these would be registered via PcNewWaveCyclicMiniport()
// with a KSDATAFORMAT_WAVEFORMATEX for 48kHz/32-bit float/mono.
// The capture callback would call VcbReadFromRing() to fill each DMA buffer.

// Placeholder: demonstrates where the capture ISR/DPC would integrate
NTSTATUS VcbCaptureCallback(
    VCB_DEVICE_CONTEXT* ctx,
    PVOID dmaBuffer,
    ULONG byteCount)
{
    ULONG sampleCount = byteCount / sizeof(float);
    VcbReadFromRing(ctx, (float*)dmaBuffer, sampleCount);
    return STATUS_SUCCESS;
}

// ---- Driver entry point (prototype) ----

// In production: DriverEntry → PcInitializeMiniportDriver → PcAddAdapterDevice
// with the wave cyclic miniport descriptor pointing to our capture callbacks.
// The INF would register this as an audio capture endpoint under
// HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e96c-...}

NTSTATUS DriverEntry(PDRIVER_OBJECT DriverObject, PUNICODE_STRING RegistryPath)
{
    UNREFERENCED_PARAMETER(RegistryPath);
    PAGED_CODE();

    DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
               "VCB: Virtual capture endpoint driver loading\n");

    // TODO: Register AVStream miniport with port class
    // TODO: Create device object with VCB_DEVICE_CONTEXT extension
    // TODO: On device start, call VcbInitSharedMemory()
    // TODO: On device stop/remove, call VcbCleanupSharedMemory()

    UNREFERENCED_PARAMETER(DriverObject);
    return STATUS_SUCCESS;
}