// VCB WaveRT Capture Stream — Header
// Based on sysvad CMiniportWaveRTStream architecture.
// Integrates with shared memory ring buffer for capture data source.

#pragma once

#include "vcb_common.h"

// Forward declaration
class CMiniportWaveRT;

class CMiniportWaveRTStream : public IMiniportWaveRTStreamNotification,
                               public CUnknown
{
private:
    CMiniportWaveRT*      m_pMiniport;
    BOOLEAN               m_bCapture;
    KSSTATE               m_KsState;
    PRKDPC                m_pDpc;
    ULONGLONG             m_ullLinearPosition;
    ULONGLONG             m_llPacketCounter;
    PVOID                 m_pDmaBuffer;
    ULONG                 m_ulDmaBufferSize;
    ULONG                 m_ulBytesPerPacket;
    LARGE_INTEGER         m_qpcFrequency;
    LARGE_INTEGER         m_qpcLastDPCTime;
    LIST_ENTRY            m_NotificationList;
    KSPIN_LOCK            m_NotificationLock;

    // Shared memory context (pointer to adapter's context, not owned by stream)
    VCB_SHM_CONTEXT*      m_pShmContext;

public:
    DECLARE_STD_UNKNOWN();
    DEFINE_STD_CONSTRUCTOR(CMiniportWaveRTStream);

    ~CMiniportWaveRTStream();

    // IMiniportWaveRTStreamNotification methods
    STDMETHODIMP_(NTSTATUS) AllocateAudioBuffer(
        _In_ ULONG RequestedBufferSize,
        _Out_ PMDL* AudioBufferMdl,
        _Out_ ULONG* ActualBufferSize,
        _Out_ ULONG* OffsetFromFirstPage,
        _Out_ MEMORY_CACHING_TYPE* CacheType);

    STDMETHODIMP_(VOID) FreeAudioBuffer(_In_opt_ PMDL Mdl, _In_ ULONG BufferSize);

    STDMETHODIMP_(NTSTATUS) GetHWLatency(
        _Inout_ KSRTAUDIO_HWLATENCY* Latency);

    STDMETHODIMP_(NTSTATUS) RegisterForEventNotification(
        _In_ PKSEVENT_ENTRY EventEntry);

    STDMETHODIMP_(VOID) UnregisterAllEventNotifications();

    STDMETHODIMP_(NTSTATUS) SetWritePacket(
        _In_ ULONG PacketNumber,
        _In_ DWORD Flags,
        _In_ ULONG EosPacketLength);

    STDMETHODIMP_(NTSTATUS) GetReadPacket(
        _Out_ ULONG* PacketNumber,
        _Out_ DWORD* Flags,
        _Out_ ULONG64* PerformanceCounterValue,
        _Out_ BOOL* MoreData);

    // Stream lifecycle
    NTSTATUS Init(
        _In_ CMiniportWaveRT* Miniport,
        _In_ BOOLEAN Capture,
        _In_ VCB_SHM_CONTEXT* ShmContext);

    NTSTATUS SetState(_In_ KSSTATE NewState);

    // Timer callback (static, called by kernel timer)
    static VOID TimerNotifyRT(_In_ PKDPC Dpc, _In_opt_ PVOID DeferredContext,
                               _In_opt_ PVOID SysArg1, _In_opt_ PVOID SysArg2);

private:
    VOID UpdatePosition(_In_ LARGE_INTEGER qpcTime);
    VOID WriteBytes(_In_ ULONG ByteDisplacement);
    VOID GenerateSilence(_Out_writes_bytes_(ByteCount) PVOID Buffer, _In_ ULONG ByteCount);
};