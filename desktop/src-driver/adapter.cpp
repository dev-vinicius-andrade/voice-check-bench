// VCB Virtual Audio Capture Driver — Adapter Entry Point
// Based on sysvad adapter.cpp architecture.
// Registers a single capture-only endpoint with Port Class.

#include "vcb_common.h"

#pragma code_seg("INIT")

// ---- Endpoint Descriptor ----
// Single capture pin, no render pins, no topology connections needed for minimal device.
static const KSPIN_PHYSICALCONNECTION g_PhysicalConnections[] = {
    { KSPIN_TOPO_BRIDGE_DESTINATION, VCB_PIN_CAPTURE }
};

// ---- CreateMiniport Callbacks (forward declarations) ----
extern NTSTATUS CreateMiniportWaveRTVcb(
    _Out_ PUNKNOWN* Unknown,
    _In_ REFCLSID RefClsId,
    _In_opt_ PUNKNOWN OuterUnknown,
    _In_ POOL_TYPE PoolType);

extern NTSTATUS CreateMiniportTopologyVcb(
    _Out_ PUNKNOWN* Unknown,
    _In_ REFCLSID RefClsId,
    _In_opt_ PUNKNOWN OuterUnknown,
    _In_ POOL_TYPE PoolType);

// ---- Miniport Pair Tablestatic const VCB_MINIPORT_PAIR g_MiniportPairs[] = {
    {
        CreateMiniportWaveRTVcb,
        CreateMiniportTopologyVcb,
        g_PhysicalConnections,
        RTL_NUMBER_OF(g_PhysicalConnections),
    }
};

// ---- Device Extension ----
typedef struct _VCB_DEVICE_EXTENSION {
    WDFDEVICE       WdfDevice;
    VCB_SHM_CONTEXT ShmContext;
} VCB_DEVICE_EXTENSION;

WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(VCB_DEVICE_EXTENSION, VcbGetDeviceExtension);

// ---- EVT_WDF_DRIVER_DEVICE_ADD ----
#pragma code_seg("PAGE")
NTSTATUS EvtDeviceAdd(_In_ WDFDRIVER Driver, _Inout_ PWDFDEVICE_INIT DeviceInit)
{
    PAGED_CODE();
    UNREFERENCED_PARAMETER(Driver);

    WDF_OBJECT_ATTRIBUTES attr;
    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&attr, VCB_DEVICE_EXTENSION);

    WDFDEVICE device;
    NTSTATUS status = WdfDeviceCreate(&DeviceInit, &attr, &device);
    if (!NT_SUCCESS(status)) {
        DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_ERROR_LEVEL,
            "VCB: WdfDeviceCreate failed: 0x%08X\n", status);
        return status;
    }

    VCB_DEVICE_EXTENSION* ext = VcbGetDeviceExtension(device);
    ext->WdfDevice = device;

    // Initialize shared memory connection to user-mode service
    status = VcbShmInit(&ext->ShmContext);
    if (!NT_SUCCESS(status)) {
        DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_WARNING_LEVEL,
            "VCB: Shared memory init failed (user-mode service may not be running): 0x%08X\n", status);
        // Continue anyway — driver will produce silence until service connects
    }

    // Register audio endpoints with Port Class
    // In production: iterate g_MiniportPairs and call PcAddAdapterDevice for each
    // For this prototype, we register via the INF's AddInterface directives

    DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
        "VCB: Device added successfully\n");

    return STATUS_SUCCESS;
}

// ---- EVT_WDF_DEVICE_PREPARE_HARDWARE#pragma code_seg("PAGE")
NTSTATUS EvtPrepareHardware(
    _In_ WDFDEVICE Device,
    _In_ WDFCMRESLIST ResourcesRaw,
    _In_ WDFCMRESLIST ResourcesTranslated)
{
    PAGED_CODE();
    UNREFERENCED_PARAMETER(ResourcesRaw);
    UNREFERENCED_PARAMETER(ResourcesTranslated);

    VCB_DEVICE_EXTENSION* ext = VcbGetDeviceExtension(Device);

    // Try to connect/reconnect shared memory if it wasn't available at DeviceAdd
    if (!ext->ShmContext.Initialized) {
        NTSTATUS status = VcbShmInit(&ext->ShmContext);
        if (NT_SUCCESS(status)) {
            DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
                "VCB: Shared memory connected on PrepareHardware\n");
        }
    }

    return STATUS_SUCCESS;
}

// ---- EVT_WDF_DEVICE_RELEASE_HARDWARE ----
#pragma code_seg("PAGE")
NTSTATUS EvtReleaseHardware(
    _In_ WDFDEVICE Device,
    _In_ WDFCMRESLIST ResourcesTranslated)
{
    PAGED_CODE();
    UNREFERENCED_PARAMETER(ResourcesTranslated);

    VCB_DEVICE_EXTENSION* ext = VcbGetDeviceExtension(Device);
    VcbShmCleanup(&ext->ShmContext);

    return STATUS_SUCCESS;
}

// ---- DriverEntry ----
#pragma code_seg("INIT")
NTSTATUS DriverEntry(
    _In_ PDRIVER_OBJECT DriverObject,
    _In_ PUNICODE_STRING RegistryPath)
{
    DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
        "VCB: DriverEntry — Virtual Audio Capture Driver loading\n");

    WDF_DRIVER_CONFIG config;
    WDF_DRIVER_CONFIG_INIT(&config, EvtDeviceAdd);
    config.DriverInitFlags |= WdfDriverInitNonPnpDriver;

    WDF_OBJECT_ATTRIBUTES attr;
    WDF_OBJECT_ATTRIBUTES_INIT(&attr);
    attr.ParentObject = NULL;

    WDFDRIVER driver;
    NTSTATUS status = WdfDriverCreate(
        DriverObject, RegistryPath, &attr, &config, &driver);

    if (!NT_SUCCESS(status)) {
        DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_ERROR_LEVEL,
            "VCB: WdfDriverCreate failed: 0x%08X\n", status);
        return status;
    }

    DbgPrintEx(DPFLTR_DEFAULT_ID, DPFLTR_INFO_LEVEL,
        "VCB: Driver initialized successfully\n");

    return STATUS_SUCCESS;
}