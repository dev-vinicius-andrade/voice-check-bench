// VCB WaveRT Capture Stream — Implementation
// Based on sysvad CMiniportWaveRTStream architecture.
// Key integration point: WriteBytes() reads from shared memory ring buffer
// instead of generating sine waves. Runs at DISPATCH_LEVEL (timer/DPC context).

#include "minwavertstream.h"

#pragma code_seg("PAGE")

CMiniportWaveRTStream::~CMiniportWaveRTStream()
{
    PAGED_CODE();

    if (m_pDpc) {
        KeCancelTimer(NULL); // Timer is owned by miniport, not stream
        ExFreePoolWithTag(m_pDpc, VCB_POOL_TAG_STREAM);
        m_pDpc = NULL;
    }

    // Unregister all event notifications
    KIRQL oldIrql;
    KeAcquireSpinLock(&m_NotificationLock, &oldIrql);
    while (!IsListEmpty(&m_NotificationList)) {
        PLIST_ENTRY entry = RemoveHeadList(&m_NotificationList);
        PKSEVENT_ENTRY eventEntry = CONTAINING_RECORD(entry, KSEVENT_ENTRY, ListEntry);
        KeReleaseSpinLock(&m_NotificationLock, oldIrql);
        KsRemoveEvent(eventEntry);
        KeAcquireSpinLock(&m_NotificationLock, &oldIrql);
    }
    KeReleaseSpinLock(&m_NotificationLock, oldIrql);
}

NTSTATUS CMiniportWaveRTStream::Init(
    _In_ CMiniportWaveRT* Miniport,
    _In_ BOOLEAN Capture,
    _In_ VCB_SHM_CONTEXT* ShmContext)
{
    PAGED_CODE();

    m_pMiniport = Miniport;
    m_bCapture = Capture;
    m_KsState = KSSTATE_STOP;
    m_ullLinearPosition = 0;
    m_llPacketCounter = 0;
    m_pDmaBuffer = NULL;
    m_ulDmaBufferSize = 0;
    m_ulBytesPerPacket = VCB_BLOCK_SAMPLES * VCB_BYTES_PER_SAMPLE;
    m_pShmContext = ShmContext;

    KeQueryPerformanceCounter(&m_qpcFrequency);
    m_qpcLastDPCTime.QuadPart = 0;

    InitializeListHead(&m_NotificationList);
    KeInitializeSpinLock(&m_NotificationLock);

    // Allocate DPC for timer notifications
    m_pDpc = (PRKDPC)ExAllocatePool2(POOL_FLAG_NON_PAGED, sizeof(KDPC), VCB_POOL_TAG_STREAM);
    if (!m_pDpc) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    KeInitializeDpc(m_pDpc, TimerNotifyRT, this);

    DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
        "VCB: Capture stream initialized (packet size %u bytes)\n", m_ulBytesPerPacket);

    return STATUS_SUCCESS;
}

// ---- IMiniportWaveRTStreamNotification ----

STDMETHODIMP_(NTSTATUS) CMiniportWaveRTStream::AllocateAudioBuffer(
    _In_ ULONG RequestedBufferSize,
    _Out_ PMDL* AudioBufferMdl,
    _Out_ ULONG* ActualBufferSize,
    _Out_ ULONG* OffsetFromFirstPage,
    _Out_ MEMORY_CACHING_TYPE* CacheType)
{
    PAGED_CODE();

    // Round up to packet boundary
    ULONG bufferSize = ((RequestedBufferSize + m_ulBytesPerPacket - 1) / m_ulBytesPerPacket) * m_ulBytesPerPacket;
    if (bufferSize < m_ulBytesPerPacket * 2) {
        bufferSize = m_ulBytesPerPacket * 2; // Minimum 2 packets
    }

    PVOID buffer = ExAllocatePool2(POOL_FLAG_NON_PAGED | POOL_FLAG_ZERO_INITIALIZE,
                                    bufferSize, VCB_POOL_TAG_STREAM);
    if (!buffer) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    PMDL mdl = IoAllocateMdl(buffer, bufferSize, FALSE, FALSE, NULL);
    if (!mdl) {
        ExFreePoolWithTag(buffer, VCB_POOL_TAG_STREAM);
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    MmBuildMdlForNonPagedPool(mdl);

    m_pDmaBuffer = buffer;
    m_ulDmaBufferSize = bufferSize;

    *AudioBufferMdl = mdl;
    *ActualBufferSize = bufferSize;
    *OffsetFromFirstPage = 0;
    *CacheType = MmNonCached;

    DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
        "VCB: DMA buffer allocated: %u bytes (%u packets)\n",
        bufferSize, bufferSize / m_ulBytesPerPacket);

    return STATUS_SUCCESS;
}

STDMETHODIMP_(VOID) CMiniportWaveRTStream::FreeAudioBuffer(
    _In_opt_ PMDL Mdl, _In_ ULONG BufferSize)
{
    PAGED_CODE();
    UNREFERENCED_PARAMETER(BufferSize);

    if (Mdl) {
        if (m_pDmaBuffer) {
            ExFreePoolWithTag(m_pDmaBuffer, VCB_POOL_TAG_STREAM);
            m_pDmaBuffer = NULL;
        }
        IoFreeMdl(Mdl);
    }
    m_ulDmaBufferSize = 0;
}

STDMETHODIMP_(NTSTATUS) CMiniportWaveRTStream::GetHWLatency(
    _Inout_ KSRTAUDIO_HWLATENCY* Latency)
{
    PAGED_CODE();

    if (!Latency) return STATUS_INVALID_PARAMETER;

    // Minimal latency: one packet of buffering
    Latency->ChipsetDelay = 0;
    Latency->CodecDelay = 0;
    Latency->FifoSize = m_ulBytesPerPacket;

    return STATUS_SUCCESS;
}

STDMETHODIMP_(NTSTATUS) CMiniportWaveRTStream::RegisterForEventNotification(
    _In_ PKSEVENT_ENTRY EventEntry)
{
    PAGED_CODE();

    KIRQL oldIrql;
    KeAcquireSpinLock(&m_NotificationLock, &oldIrql);
    InsertTailList(&m_NotificationList, &EventEntry->ListEntry);
    KeReleaseSpinLock(&m_NotificationLock, oldIrql);

    return STATUS_SUCCESS;
}

STDMETHODIMP_(VOID) CMiniportWaveRTStream::UnregisterAllEventNotifications()
{
    PAGED_CODE();

    KIRQL oldIrql;
    KeAcquireSpinLock(&m_NotificationLock, &oldIrql);
    while (!IsListEmpty(&m_NotificationList)) {
        PLIST_ENTRY entry = RemoveHeadList(&m_NotificationList);
        PKSEVENT_ENTRY eventEntry = CONTAINING_RECORD(entry, KSEVENT_ENTRY, ListEntry);
        KeReleaseSpinLock(&m_NotificationLock, oldIrql);
        KsRemoveEvent(eventEntry);
        KeAcquireSpinLock(&m_NotificationLock, &oldIrql);
    }
    KeReleaseSpinLock(&m_NotificationLock, oldIrql);
}

STDMETHODIMP_(NTSTATUS) CMiniportWaveRTStream::SetWritePacket(
    _In_ ULONG PacketNumber, _In_ DWORD Flags, _In_ ULONG EosPacketLength)
{
    PAGED_CODE();
    UNREFERENCED_PARAMETER(PacketNumber);
    UNREFERENCED_PARAMETER(Flags);
    UNREFERENCED_PARAMETER(EosPacketLength);
    // Not used for capture streams
    return STATUS_NOT_SUPPORTED;
}

STDMETHODIMP_(NTSTATUS) CMiniportWaveRTStream::GetReadPacket(
    _Out_ ULONG* PacketNumber,
    _Out_ DWORD* Flags,
    _Out_ ULONG64* PerformanceCounterValue,
    _Out_ BOOL* MoreData)
{
    PAGED_CODE();

    if (!PacketNumber || !Flags || !PerformanceCounterValue || !MoreData) {
        return STATUS_INVALID_PARAMETER;
    }

    LARGE_INTEGER qpc;
    KeQueryPerformanceCounter(&qpc);

    *PacketNumber = (ULONG)m_llPacketCounter;
    *Flags = 0;
    *PerformanceCounterValue = qpc.QuadPart;
    *MoreData = FALSE;

    m_llPacketCounter++;

    return STATUS_SUCCESS;
}

// ---- Stream State ----

NTSTATUS CMiniportWaveRTStream::SetState(_In_ KSSTATE NewState)
{
    PAGED_CODE();

    if (NewState == m_KsState) return STATUS_SUCCESS;

    switch (NewState) {
    case KSSTATE_ACQUIRE:
        m_ullLinearPosition = 0;
        m_llPacketCounter = 0;
        break;

    case KSSTATE_RUN:
        KeQueryPerformanceCounter(&m_qpcLastDPCTime);
        // Start periodic timer for capture data generation
        // In production: use KeSetTimerEx with notification interval
        break;

    case KSSTATE_PAUSE:
    case KSSTATE_STOP:
        break;
    }

    m_KsState = NewState;
    return STATUS_SUCCESS;
}

// ---- Timer Callback (DISPATCH_LEVEL) ----

#pragma code_seg() // Non-paged for DISPATCH_LEVEL

VOID CMiniportWaveRTStream::TimerNotifyRT(
    _In_ PKDPC Dpc,
    _In_opt_ PVOID DeferredContext,
    _In_opt_ PVOID SysArg1,
    _In_opt_ PVOID SysArg2)
{
    UNREFERENCED_PARAMETER(Dpc);
    UNREFERENCED_PARAMETER(SysArg1);
    UNREFERENCED_PARAMETER(SysArg2);

    CMiniportWaveRTStream* stream = (CMiniportWaveRTStream*)DeferredContext;
    if (!stream || stream->m_KsState != KSSTATE_RUN) return;

    LARGE_INTEGER qpc;
    KeQueryPerformanceCounter(&qpc);
    stream->UpdatePosition(qpc);
}

VOID CMiniportWaveRTStream::UpdatePosition(_In_ LARGE_INTEGER qpcTime)
{
    // Calculate elapsed time since last update
    LONGLONG elapsed = qpcTime.QuadPart - m_qpcLastDPCTime.QuadPart;
    if (elapsed <= 0) return;

    // Convert to bytes: elapsed_ticks / freq_ticks_per_sec * bytes_per_sec
    ULONGLONG bytesElapsed = (ULONGLONG)elapsed * VCB_AVG_BYTES_PER_SEC / m_qpcFrequency.QuadPart;

    if (bytesElapsed > 0) {
        WriteBytes((ULONG)bytesElapsed);
        m_ullLinearPosition += bytesElapsed;
        m_qpcLastDPCTime = qpcTime;
    }
}

/// Core capture data injection point. Called at DISPATCH_LEVEL.
/// Reads from shared memory ring buffer; zero-fills on underrun.
VOID CMiniportWaveRTStream::WriteBytes(_In_ ULONG ByteDisplacement)
{
    if (!m_pDmaBuffer || m_ulDmaBufferSize == 0) return;

    ULONG bufferOffset = (ULONG)(m_ullLinearPosition % m_ulDmaBufferSize);
    ULONG bytesRemaining = ByteDisplacement;

    while (bytesRemaining > 0) {
        ULONG runWrite = min(bytesRemaining, m_ulDmaBufferSize - bufferOffset);
        float* dest = (float*)((PUCHAR)m_pDmaBuffer + bufferOffset);
        ULONG samplesNeeded = runWrite / VCB_BYTES_PER_SAMPLE;

        // PRIMARY INTEGRATION POINT: read from shared memory ring buffer
        ULONG samplesRead = 0;
        if (m_pShmContext && m_pShmContext->Initialized) {
            samplesRead = VcbShmReadSamples(m_pShmContext, dest, samplesNeeded);
        }

        // Zero-fill any remaining samples (underrun or no shared memory)
        if (samplesRead < samplesNeeded) {
            GenerateSilence(dest + samplesRead, (samplesNeeded - samplesRead) * VCB_BYTES_PER_SAMPLE);
        }

        bufferOffset = (bufferOffset + runWrite) % m_ulDmaBufferSize;
        bytesRemaining -= runWrite;
    }

    // Notify registered events that new data is available
    KIRQL oldIrql;
    KeAcquireSpinLock(&m_NotificationLock, &oldIrql);
    PLIST_ENTRY entry = m_NotificationList.Flink;
    while (entry != &m_NotificationList) {
        PKSEVENT_ENTRY eventEntry = CONTAINING_RECORD(entry, KSEVENT_ENTRY, ListEntry);
        entry = entry->Flink;
        KeReleaseSpinLock(&m_NotificationLock, oldIrql);
        KsGenerateEvent(eventEntry);
        KeAcquireSpinLock(&m_NotificationLock, &oldIrql);
    }
    KeReleaseSpinLock(&m_NotificationLock, oldIrql);
}

VOID CMiniportWaveRTStream::GenerateSilence(
    _Out_writes_bytes_(ByteCount) PVOID Buffer, _In_ ULONG ByteCount)
{
    RtlZeroMemory(Buffer, ByteCount);
}