// VCB Shared Memory Helper — Kernel-mode reader for the user-mode ring buffer.
// All functions operate at DISPATCH_LEVEL or below (safe for timer/DPC context).
// Uses only non-paged pool and atomic operations — no mutexes, no pageable memory.

#include "vcb_common.h"

#pragma code_seg("PAGE")

NTSTATUS VcbShmInit(VCB_SHM_CONTEXT* ctx)
{
    PAGED_CODE();

    if (!ctx) return STATUS_INVALID_PARAMETER;

    RtlZeroMemory(ctx, sizeof(*ctx));
    KeInitializeSpinLock(&ctx->Lock);

    UNICODE_STRING shmName;
    RtlInitUnicodeString(&shmName, VCB_SHM_NAME);

    OBJECT_ATTRIBUTES oa;
    InitializeObjectAttributes(&oa, &shmName, OBJ_KERNEL_HANDLE, NULL, NULL);

    // Open existing section created by user-mode service
    NTSTATUS status = ZwOpenSection(&ctx->SectionHandle, SECTION_MAP_READ, &oa);
    if (!NT_SUCCESS(status)) {
        DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_WARNING_LEVEL,
            "VCB: Failed to open shared memory section: 0x%08X\n", status);
        ctx->Initialized = FALSE;
        return status;
    }

    SIZE_T viewSize = VCB_SHM_SIZE;
    status = ZwMapViewOfSection(
        ctx->SectionHandle, NtCurrentProcess(),
        &ctx->MappedBase, 0, VCB_SHM_SIZE,
        NULL, &viewSize, ViewUnmap, 0, PAGE_READONLY);

    if (!NT_SUCCESS(status)) {
        DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_ERROR_LEVEL,
            "VCB: Failed to map shared memory: 0x%08X\n", status);
        ZwClose(ctx->SectionHandle);
        ctx->SectionHandle = NULL;
        ctx->Initialized = FALSE;
        return status;
    }

    ctx->RingHeader = (VCB_RING_HEADER*)ctx->MappedBase;

    // Validate format
    if (ctx->RingHeader->sampleRate != VCB_SAMPLE_RATE ||
        ctx->RingHeader->blockSamples != VCB_BLOCK_SAMPLES ||
        ctx->RingHeader->channels != VCB_CHANNELS) {
        DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_ERROR_LEVEL,
            "VCB: Format mismatch in shared memory header\n");
        ZwUnmapViewOfSection(NtCurrentProcess(), ctx->MappedBase);
        ZwClose(ctx->SectionHandle);
        ctx->MappedBase = NULL;
        ctx->SectionHandle = NULL;
        ctx->Initialized = FALSE;
        return STATUS_DEVICE_DATA_ERROR;
    }

    ctx->Initialized = TRUE;
    DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
        "VCB: Shared memory mapped at %p (%u samples capacity)\n",
        ctx->MappedBase, VCB_RING_SAMPLES);

    return STATUS_SUCCESS;
}

VOID VcbShmCleanup(VCB_SHM_CONTEXT* ctx)
{
    PAGED_CODE();

    if (!ctx) return;

    if (ctx->MappedBase) {
        ZwUnmapViewOfSection(NtCurrentProcess(), ctx->MappedBase);
        ctx->MappedBase = NULL;
    }
    if (ctx->SectionHandle) {
        ZwClose(ctx->SectionHandle);
        ctx->SectionHandle = NULL;
    }
    ctx->RingHeader = NULL;
    ctx->Initialized = FALSE;
}

#pragma code_seg() // Back to default (non-paged) for DISPATCH_LEVEL-safe reads

/// Read samples from the ring buffer into dest. Returns number of samples actually read.
/// Safe to call at DISPATCH_LEVEL (timer/DPC context). Lock-free: uses atomic loads only.
ULONG VcbShmReadSamples(VCB_SHM_CONTEXT* ctx, float* dest, ULONG sampleCount)
{
    if (!ctx || !ctx->Initialized || !ctx->RingHeader || !dest || sampleCount == 0) {
        return 0;
    }

    // Check if user-mode service is active (atomic read, safe at DISPATCH_LEVEL)
    LONG active = InterlockedCompareExchange(&ctx->RingHeader->active, 0, 0);
    if (active == 0) {
        return 0;
    }

    float* ringBuf = VCB_RING_BUFFER(ctx->RingHeader);

    // Atomic snapshot of positions
    ULONG writePos = (ULONG)InterlockedCompareExchange(&ctx->RingHeader->writePos, 0, 0);
    ULONG readPos  = (ULONG)InterlockedCompareExchange(&ctx->RingHeader->readPos, 0, 0);
    ULONG readable = writePos - readPos; // unsigned wraparound gives correct distance

    if (readable == 0) {
        return 0; // Underrun — caller should zero-fill
    }

    // Clamp to available
    ULONG toRead = (sampleCount <= readable) ? sampleCount : readable;

    ULONG ringIdx = readPos % VCB_RING_SAMPLES;
    ULONG firstChunk = VCB_RING_SAMPLES - ringIdx;

    if (firstChunk >= toRead) {
        // No wrap needed
        RtlCopyMemory(dest, &ringBuf[ringIdx], toRead * sizeof(float));
    } else {
        // Wrap around the ring
        RtlCopyMemory(dest, &ringBuf[ringIdx], firstChunk * sizeof(float));
        RtlCopyMemory(&dest[firstChunk], &ringBuf[0], (toRead - firstChunk) * sizeof(float));
    }

    // Advance read position atomically
    InterlockedExchange(&ctx->RingHeader->readPos, readPos + toRead);

    return toRead;
}