// VCB Format Descriptors — 48kHz / 32-bit IEEE Float / Mono capture
// Based on sysvad endpoint wavtable pattern.
// Defines KSDATAFORMAT_WAVEFORMATEXTENSIBLE for Port Class format negotiation.

#include "vcb_common.h"

// ---- IEEE Float 48kHz Mono Capture Format ----
static const KSDATAFORMAT_WAVEFORMATEXTENSIBLE g_CaptureFormat48k32fMono = {
    {
        sizeof(KSDATAFORMAT_WAVEFORMATEXTENSIBLE),
        0,
        0,
        0,
        STATICGUIDOF(KSDATAFORMAT_TYPE_AUDIO),
        STATICGUIDOF(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_VCB),
        STATICGUIDOF(KSDATAFORMAT_SPECIFIER_WAVEFORMATEX)
    },
    {
        {
            WAVE_FORMAT_EXTENSIBLE,
            VCB_NUM_CHANNELS,
            VCB_SAMPLE_RATE,
            VCB_AVG_BYTES_PER_SEC,
            VCB_BLOCK_ALIGN,
            VCB_BITS_PER_SAMPLE,
            sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)
        },
        VCB_BITS_PER_SAMPLE,          // wValidBitsPerSample
        SPEAKER_FRONT_CENTER,         // dwChannelMask (mono)
        STATICGUIDOF(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_VCB)  // SubFormat
    }
};

// ---- Pin Data Range ----
static const KSDATARANGE_AUDIO g_CapturePinDataRange = {
    {
        sizeof(KSDATARANGE_AUDIO),
        0,
        0,
        0,
        STATICGUIDOF(KSDATAFORMAT_TYPE_AUDIO),
        STATICGUIDOF(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_VCB),
        STATICGUIDOF(KSDATAFORMAT_SPECIFIER_WAVEFORMATEX)
    },
    VCB_NUM_CHANNELS,     // MaximumChannels
    VCB_NUM_CHANNELS,     // MinimumChannels
    VCB_SAMPLE_RATE,      // MinimumSampleFrequency
    VCB_SAMPLE_RATE,      // MaximumSampleFrequency
    VCB_BITS_PER_SAMPLE,  // MinimumBitsPerSample
    VCB_BITS_PER_SAMPLE   // MaximumBitsPerSample
};

// ---- Exported Tables ----

const PKSDATAFORMAT g_CaptureFormats[] = {
    (PKSDATAFORMAT)&g_CaptureFormat48k32fMono
};
const ULONG g_NumCaptureFormats = RTL_NUMBER_OF(g_CaptureFormats);

const PKSDATARANGE g_CapturePinDataRanges[] = {
    (PKSDATARANGE)&g_CapturePinDataRange
};
const ULONG g_NumCapturePinDataRanges = RTL_NUMBER_OF(g_CapturePinDataRanges);