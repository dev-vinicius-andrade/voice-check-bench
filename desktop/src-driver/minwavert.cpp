// VCB WaveRT Miniport — Capture-only endpoint registration with Port Class
// Based on sysvad CMiniportWaveRT architecture.
// Creates capture streams that read from shared memory ring buffer.

#include "vcb_common.h"
#include "minwavertstream.h"

// ---- External format tables (vcb_wavtable.cpp) ----
extern const PKSDATAFORMAT g_CaptureFormats[];
extern const ULONG g_NumCaptureFormats;
extern const PKSDATARANGE g_CapturePinDataRanges[];
extern const ULONG g_NumCapturePinDataRanges;

// ---- Pin Descriptor for Capture ----
static const KSPIN_DESCRIPTOR_EX g_CapturePinDescriptor = {
    NULL,                               // Dispatch table (use default)
    NULL,                               // Automation table
    {
        0,                              // Flags
        KSPIN_LIFETIME_PERSIST,         // Lifetime
        KSPIN_DATAFLOW_IN,              // DataFlow (capture = data flows INTO host)
        KSPIN_COMMUNICATION_BOTH,       // Communication
        &KSCATEGORY_AUDIO,              // Category GUID
        NULL,                           // Name
        0                               // Reserved
    },
    1,                                  // PinId
    1,                                  // MaxInstances
    0,                                  // MinResources
    TRUE,                               // Render (FALSE = capture)
    FALSE,                              // Loopback
    KSPIN_FLAG_DISPATCH_LEVEL_PROCESSING,// FlagsEx
};

// ---- CMiniportWaveRT ----

class CMiniportWaveRT : public IMiniportWaveRT, public CUnknown
{
private:
    PADAPTERCOMMON m_AdapterCommon;
    VCB_SHM_CONTEXT* m_pShmContext;
    PPCFILTER_DESCRIPTOR m_FilterDescriptor;

public:
    DECLARE_STD_UNKNOWN();
    DEFINE_STD_CONSTRUCTOR(CMiniportWaveRT);
    ~CMiniportWaveRT();

    // IMiniport
    STDMETHODIMP GetDescription(_Out_ PPCFILTER_DESCRIPTOR* OutFilterDescriptor);
    STDMETHODIMP Init(
        _In_opt_ PUNKNOWN UnknownAdapter,
        _In_ PRESOURCELIST ResourceList,
        _In_ PPORTWAVERT Port);
    STDMETHODIMP_(VOID) ServiceGroup(_In_opt_ PSERVICEGROUP ServiceGroup);

    // IMiniportWaveRT
    STDMETHODIMP AllocateAudioBuffer(
        _In_ ULONG RequestedBufferSize,
        _Out_ PMDL* AudioBufferMdl,
        _Out_ ULONG* ActualBufferSize,
        _Out_ ULONG* OffsetFromFirstPage,
        _Out_ MEMORY_CACHING_TYPE* CacheType);
    STDMETHODIMP_(VOID) FreeAudioBuffer(_In_opt_ PMDL Mdl, _In_ ULONG BufferSize);
    STDMETHODIMP GetHWLatency(_Inout_ KSRTAUDIO_HWLATENCY* Latency);
    STDMETHODIMP RegisterForEventNotification(_In_ PKSEVENT_ENTRY EventEntry);
    STDMETHODIMP_(VOID) UnregisterAllEventNotifications();
    STDMETHODIMP SetWritePacket(_In_ ULONG PacketNumber, _In_ DWORD Flags, _In_ ULONG EosPacketLength);
    STDMETHODIMP GetReadPacket(
        _Out_ ULONG* PacketNumber, _Out_ DWORD* Flags,
        _Out_ ULONG64* PerformanceCounterValue, _Out_ BOOL* MoreData);

    // Stream creation
    NTSTATUS NewStream(
        _Out_ PMINIPORTWAVERTSTREAM* OutStream,
        _In_ PPORTWAVERTSTREAM PortStream,
        _In_ ULONG PinId,
        _In_ BOOLEAN Capture,
        _In_ PKSDATAFORMAT DataFormat);

    // Shared memory access
    VOID SetShmContext(_In_ VCB_SHM_CONTEXT* ctx) { m_pShmContext = ctx; }
};

#pragma code_seg("PAGE")

CMiniportWaveRT::~CMiniportWaveRT()
{
    PAGED_CODE();
    if (m_FilterDescriptor) {
        ExFreePoolWithTag(m_FilterDescriptor, VCB_POOL_TAG_ADAPTER);
    }
}

STDMETHODIMP CMiniportWaveRT::GetDescription(_Out_ PPCFILTER_DESCRIPTOR* OutFilterDescriptor)
{
    PAGED_CODE();

    if (!OutFilterDescriptor) return STATUS_INVALID_PARAMETER;

    if (!m_FilterDescriptor) {
        // Build filter descriptor dynamically
        m_FilterDescriptor = (PPCFILTER_DESCRIPTOR)ExAllocatePool2(
            POOL_FLAG_PAGED, sizeof(PCFILTER_DESCRIPTOR), VCB_POOL_TAG_ADAPTER);
        if (!m_FilterDescriptor) return STATUS_INSUFFICIENT_RESOURCES;

        RtlZeroMemory(m_FilterDescriptor, sizeof(PCFILTER_DESCRIPTOR));
        m_FilterDescriptor->Version = PCAUDIODRIVERVERSION_WIN8;
        m_FilterDescriptor->MaxInstanceCount = 1;
        m_FilterDescriptor->PinCount = 1;
        m_FilterDescriptor->Pins = &g_CapturePinDescriptor;
    }

    *OutFilterDescriptor = m_FilterDescriptor;
    return STATUS_SUCCESS;
}

STDMETHODIMP CMiniportWaveRT::Init(
    _In_opt_ PUNKNOWN UnknownAdapter,
    _In_ PRESOURCELIST ResourceList,
    _In_ PPORTWAVERT Port)
{
    PAGED_CODE();
    UNREFERENCED_PARAMETER(UnknownAdapter);
    UNREFERENCED_PARAMETER(ResourceList);
    UNREFERENCED_PARAMETER(Port);

    DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
        "VCB: WaveRT miniport initialized\n");
    return STATUS_SUCCESS;
}

STDMETHODIMP_(VOID) CMiniportWaveRT::ServiceGroup(_In_opt_ PSERVICEGROUP ServiceGroup)
{
    UNREFERENCED_PARAMETER(ServiceGroup);
}

// Delegate stream-level methods to stream object (PortCls routes these)
STDMETHODIMP CMiniportWaveRT::AllocateAudioBuffer(
    _In_ ULONG Req, _Out_ PMDL* Mdl, _Out_ ULONG* Actual,
    _Out_ ULONG* Offset, _Out_ MEMORY_CACHING_TYPE* Cache)
{ UNREFERENCED_PARAMETER(Req); UNREFERENCED_PARAMETER(Mdl); UNREFERENCED_PARAMETER(Actual);
  UNREFERENCED_PARAMETER(Offset); UNREFERENCED_PARAMETER(Cache); return STATUS_NOT_SUPPORTED; }
STDMETHODIMP_(VOID) CMiniportWaveRT::FreeAudioBuffer(_In_opt_ PMDL Mdl, _In_ ULONG Size)
{ UNREFERENCED_PARAMETER(Mdl); UNREFERENCED_PARAMETER(Size); }
STDMETHODIMP CMiniportWaveRT::GetHWLatency(_Inout_ KSRTAUDIO_HWLATENCY* L)
{ UNREFERENCED_PARAMETER(L); return STATUS_NOT_SUPPORTED; }
STDMETHODIMP CMiniportWaveRT::RegisterForEventNotification(_In_ PKSEVENT_ENTRY E)
{ UNREFERENCED_PARAMETER(E); return STATUS_NOT_SUPPORTED; }
STDMETHODIMP_(VOID) CMiniportWaveRT::UnregisterAllEventNotifications() {}
STDMETHODIMP CMiniportWaveRT::SetWritePacket(_In_ ULONG P, _In_ DWORD F, _In_ ULONG E)
{ UNREFERENCED_PARAMETER(P); UNREFERENCED_PARAMETER(F); UNREFERENCED_PARAMETER(E); return STATUS_NOT_SUPPORTED; }
STDMETHODIMP CMiniportWaveRT::GetReadPacket(
    _Out_ ULONG* P, _Out_ DWORD* F, _Out_ ULONG64* PC, _Out_ BOOL* M)
{ UNREFERENCED_PARAMETER(P); UNREFERENCED_PARAMETER(F); UNREFERENCED_PARAMETER(PC);
  UNREFERENCED_PARAMETER(M); return STATUS_NOT_SUPPORTED; }

NTSTATUS CMiniportWaveRT::NewStream(
    _Out_ PMINIPORTWAVERTSTREAM* OutStream,
    _In_ PPORTWAVERTSTREAM PortStream,
    _In_ ULONG PinId,
    _In_ BOOLEAN Capture,
    _In_ PKSDATAFORMAT DataFormat)
{
    PAGED_CODE();
    UNREFERENCED_PARAMETER(PortStream);
    UNREFERENCED_PARAMETER(DataFormat);

    if (PinId != VCB_PIN_CAPTURE || !Capture) {
        return STATUS_INVALID_PARAMETER;
    }

    CMiniportWaveRTStream* stream = new (POOL_FLAG_PAGED, VCB_POOL_TAG_STREAM) CMiniportWaveRTStream(NULL);
    if (!stream) return STATUS_INSUFFICIENT_RESOURCES;

    NTSTATUS status = stream->Init(this, Capture, m_pShmContext);
    if (!NT_SUCCESS(status)) {
        stream->Release();
        return status;
    }

    *OutStream = (PMINIPORTWAVERTSTREAM)stream;
    return STATUS_SUCCESS;
}

// ---- Factory Function (called by adapter/PcAddAdapterDevice) ----
NTSTATUS CreateMiniportWaveRTVcb(
    _Out_ PUNKNOWN* Unknown,
    _In_ REFCLSID RefClsId,
    _In_opt_ PUNKNOWN OuterUnknown,
    _In_ POOL_TYPE PoolType)
{
    PAGED_CODE();
    UNREFERENCED_PARAMETER(RefClsId);
    UNREFERENCED_PARAMETER(PoolType);

    CMiniportWaveRT* miniport = new (POOL_FLAG_PAGED, VCB_POOL_TAG_ADAPTER) CMiniportWaveRT(OuterUnknown);
    if (!miniport) return STATUS_INSUFFICIENT_RESOURCES;

    miniport->AddRef();
    *Unknown = (PUNKNOWN)(IMiniportWaveRT*)miniport;
    return STATUS_SUCCESS;
}