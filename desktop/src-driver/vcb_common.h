// VCB Virtual Audio Capture Driver — Common header
// Based on Microsoft sysvad sample architecture.
// Defines shared interfaces, GUIDs, pool tags, and device constants.

#pragma once

#include <ntddk.h>
#include <portcls.h>
#include <ksmedia.h>
#include <wdf.h>

#include "vcb_ring.h"

// ---- Pool Tags ----
#define VCB_POOL_TAG_ADAPTER    'AcBV'  // Adapter common
#define VCB_POOL_TAG_STREAM     'ScBV'  // WaveRT stream
#define VCB_POOL_TAG_TOPO       'TcBV'  // Topology miniport
#define VCB_POOL_TAG_SHM        'McBV'  // Shared memory mapping

// ---- Device GUIDs ----
// {A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
DEFINE_GUID(GUID_DEVINTERFACE_VCB_CAPTURE,
    0xa1b2c3d4, 0xe5f6, 0x7890, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78, 0x90);

// {B2C3D4E5-F6A7-8901-BCDE-F12345678901}
DEFINE_GUID(GUID_DEVCLASS_VCB_AUDIO,
    0xb2c3d4e5, 0xf6a7, 0x8901, 0xbc, 0xde, 0xf1, 0x23, 0x45, 0x67, 0x89, 0x01);

// ---- Audio Format Constants ----
#define VCB_NUM_CHANNELS        1
#define VCB_BITS_PER_SAMPLE     32
#define VCB_BYTES_PER_SAMPLE    4
#define VCB_BLOCK_ALIGN         (VCB_NUM_CHANNELS * VCB_BYTES_PER_SAMPLE)
#define VCB_AVG_BYTES_PER_SEC   (VCB_SAMPLE_RATE * VCB_BLOCK_ALIGN)

// IEEE_FLOAT subtype GUID: {00000003-0000-0010-8000-00aa00389b71}
DEFINE_GUID(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_VCB,
    0x00000003, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71);

// ---- Pin IDs ----
#define VCB_PIN_CAPTURE         0

// ---- Miniport Pair Descriptor ----
typedef struct _VCB_MINIPORT_PAIR {
    PFNCREATEMINIPORT CreateMiniportWaveRT;
    PFNCREATEMINIPORT CreateMiniportTopology;
    const KSPIN_PHYSICALCONNECTION* PhysicalConnections;
    ULONG NumPhysicalConnections;
} VCB_MINIPORT_PAIR;

// ---- Shared Memory Context (stored in device extension) ----
typedef struct _VCB_SHM_CONTEXT {
    HANDLE          SectionHandle;
    PVOID           MappedBase;
    VCB_RING_HEADER* RingHeader;
    BOOLEAN         Initialized;
    KSPIN_LOCK      Lock;
} VCB_SHM_CONTEXT;

// ---- Forward Declarations ----
NTSTATUS VcbShmInit(VCB_SHM_CONTEXT* ctx);
VOID     VcbShmCleanup(VCB_SHM_CONTEXT* ctx);
ULONG    VcbShmReadSamples(VCB_SHM_CONTEXT* ctx, float* dest, ULONG sampleCount);