// VB-Cable detection: checks whether VB-Audio Virtual Cable is installed
// by enumerating WASAPI audio endpoints and looking for "CABLE" in device names.
// This is a user-mode check — no kernel driver or admin privileges required.

#[cfg(windows)]
mod inner {
    use windows_sys::Win32::Media::Audio::{
        eCapture, eRender, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows_sys::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows_sys::Win32::System::Com::StructuredStorage::IPropertyStore;
    use windows_sys::Win32::System::Variant::{
        PropVariantClear, PropVariantToStringAlloc, PROPVARIANT,
    };
    use windows_sys::Win32::Devices::Properties::DEVPKEY_Device_FriendlyName;
    use windows_sys::core::GUID;

    // IMMDeviceEnumerator GUID: {BCDE0395-E52F-467C-8E3D-C4579291692E}
    const CLSID_MM_DEVICE_ENUMERATOR: GUID = GUID {
        data1: 0xBCDE0395,
        data2: 0xE52F,
        data3: 0x467C,
        data4: [0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E],
    };

    // IMMDeviceEnumerator interface GUID: {A95664D2-9614-4F35-A746-DE8DB63617E6}
    const IID_IMM_DEVICE_ENUMERATOR: GUID = GUID {
        data1: 0xA95664D2,
        data2: 0x9614,
        data3: 0x4F35,
        data4: [0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6],
    };

    /// Check if VB-Audio Virtual Cable is installed by enumerating active audio endpoints.
    /// Looks for "CABLE" in both render and capture device friendly names.
    #[tauri::command]
    pub fn is_vb_cable_installed() -> Result<bool, String> {
        unsafe {
            // Initialize COM for this thread
            CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED as u32);

            let mut enumerator: *mut std::ffi::c_void = std::ptr::null_mut();
            let hr = CoCreateInstance(
                &CLSID_MM_DEVICE_ENUMERATOR,
                std::ptr::null_mut(),
                CLSCTX_ALL,
                &IID_IMM_DEVICE_ENUMERATOR,
                &mut enumerator,
            );

            if hr < 0 || enumerator.is_null() {
                return Err(format!(
                    "Failed to create device enumerator: HRESULT 0x{:08X}",
                    hr
                ));
            }

            // Use raw COM vtable calls since IMMDeviceEnumerator isn't directly available
            // in windows-sys v0.59 without additional feature flags
            let enumerator = enumerator as *const IMMDeviceEnumeratorVTable;
            let vtable = (*enumerator).vtable;

            let mut found = false;

            // Check both render and capture endpoints
            for direction in [eRender, eCapture] {
                let mut collection: *mut std::ffi::c_void = std::ptr::null_mut();
                let hr = ((*vtable).EnumAudioEndpoints)(enumerator, direction, DEVICE_STATE_ACTIVE, &mut collection);
                if hr < 0 || collection.is_null() {
                    continue;
                }

                let coll = collection as *const IMMDeviceCollectionVTable;
                let coll_vt = (*coll).vtable;

                let mut count = 0u32;
                let hr = ((*coll_vt).GetCount)(coll, &mut count);
                if hr < 0 {
                    ((*coll_vt).Release)(coll);
                    continue;
                }

                for i in 0..count {
                    let mut device: *mut std::ffi::c_void = std::ptr::null_mut();
                    let hr = ((*coll_vt).Item)(coll, i, &mut device);
                    if hr < 0 || device.is_null() {
                        continue;
                    }

                    let dev = device as *const IMMDeviceVTable;
                    let dev_vt = (*dev).vtable;

                    // Get device properties
                    let mut props: *mut IPropertyStore = std::ptr::null_mut();
                    let hr = ((*dev_vt).OpenPropertyStore)(dev, 0, &mut props);
                    if hr >= 0 && !props.is_null() {
                        let ps = props as *const IPropertyStoreVTable;
                        let ps_vt = (*ps).vtable;

                        let mut var: PROPVARIANT = std::mem::zeroed();
                        let hr = ((*ps_vt).GetValue)(ps, &DEVPKEY_Device_FriendlyName, &mut var);
                        if hr >= 0 {
                            let name_ptr = PropVariantToStringAlloc(&var);
                            if !name_ptr.is_null() {
                                let mut len = 0usize;
                                while *name_ptr.add(len) != 0 {
                                    len += 1;
                                }
                                let name =
                                    String::from_utf16_lossy(std::slice::from_raw_parts(name_ptr, len));

                                if name.to_uppercase().contains("CABLE") {
                                    found = true;
                                }

                                CoTaskMemFree(name_ptr as *mut _);
                            }
                            PropVariantClear(&mut var);
                        }
                        ((*ps_vt).Release)(ps);
                    }

                    ((*dev_vt).Release)(dev);
                }

                ((*coll_vt).Release)(coll);
            }

            ((*vtable).Release)(enumerator);
            Ok(found)
        }
    }

    // Raw vtable structs for COM interfaces not fully exposed in windows-sys v0.59
    #[repr(C)]
    struct IMMDeviceEnumeratorVTable {
        vtable: *const IMMDeviceEnumeratorMethods,
    }

    #[repr(C)]
    struct IMMDeviceEnumeratorMethods {
        // IUnknown
        QueryInterface: unsafe extern "system" fn(*const std::ffi::c_void, *const GUID, *mut *mut std::ffi::c_void) -> i32,
        AddRef: unsafe extern "system" fn(*const std::ffi::c_void) -> u32,
        Release: unsafe extern "system" fn(*const std::ffi::c_void) -> u32,
        // IMMDeviceEnumerator
        EnumAudioEndpoints: unsafe extern "system" fn(*const std::ffi::c_void, i32, u32, *mut *mut std::ffi::c_void) -> i32,
        GetDefaultAudioEndpoint: unsafe extern "system" fn(*const std::ffi::c_void, i32, i32, *mut *mut std::ffi::c_void) -> i32,
        GetDevice: unsafe extern "system" fn(*const std::ffi::c_void, *const u16, *mut *mut std::ffi::c_void) -> i32,
        RegisterEndpointNotificationCallback: unsafe extern "system" fn(*const std::ffi::c_void, *mut std::ffi::c_void) -> i32,
        UnregisterEndpointNotificationCallback: unsafe extern "system" fn(*const std::ffi::c_void, *mut std::ffi::c_void) -> i32,
    }

    #[repr(C)]
    struct IMMDeviceCollectionVTable {
        vtable: *const IMMDeviceCollectionMethods,
    }

    #[repr(C)]
    struct IMMDeviceCollectionMethods {
        QueryInterface: unsafe extern "system" fn(*const std::ffi::c_void, *const GUID, *mut *mut std::ffi::c_void) -> i32,
        AddRef: unsafe extern "system" fn(*const std::ffi::c_void) -> u32,
        Release: unsafe extern "system" fn(*const std::ffi::c_void) -> u32,
        GetCount: unsafe extern "system" fn(*const std::ffi::c_void, *mut u32) -> i32,
        Item: unsafe extern "system" fn(*const std::ffi::c_void, u32, *mut *mut std::ffi::c_void) -> i32,
    }

    #[repr(C)]
    struct IMMDeviceVTable {
        vtable: *const IMMDeviceMethods,
    }

    #[repr(C)]
    struct IMMDeviceMethods {
        QueryInterface: unsafe extern "system" fn(*const std::ffi::c_void, *const GUID, *mut *mut std::ffi::c_void) -> i32,
        AddRef: unsafe extern "system" fn(*const std::ffi::c_void) -> u32,
        Release: unsafe extern "system" fn(*const std::ffi::c_void) -> u32,
        Activate: unsafe extern "system" fn(*const std::ffi::c_void, *const GUID, u32, *mut std::ffi::c_void, *mut *mut std::ffi::c_void) -> i32,
        OpenPropertyStore: unsafe extern "system" fn(*const std::ffi::c_void, u32, *mut *mut IPropertyStore) -> i32,
        GetId: unsafe extern "system" fn(*const std::ffi::c_void, *mut *mut u16) -> i32,
        GetState: unsafe extern "system" fn(*const std::ffi::c_void, *mut u32) -> i32,
    }

    #[repr(C)]
    struct IPropertyStoreVTable {
        vtable: *const IPropertyStoreMethods,
    }

    #[repr(C)]
    struct IPropertyStoreMethods {
        QueryInterface: unsafe extern "system" fn(*const std::ffi::c_void, *const GUID, *mut *mut std::ffi::c_void) -> i32,
        AddRef: unsafe extern "system" fn(*const std::ffi::c_void) -> u32,
        Release: unsafe extern "system" fn(*const std::ffi::c_void) -> u32,
        GetCount: unsafe extern "system" fn(*const std::ffi::c_void, *mut u32) -> i32,
        GetAt: unsafe extern "system" fn(*const std::ffi::c_void, u32, *mut std::ffi::c_void) -> i32,
        GetValue: unsafe extern "system" fn(*const std::ffi::c_void, *const std::ffi::c_void, *mut PROPVARIANT) -> i32,
        SetValue: unsafe extern "system" fn(*const std::ffi::c_void, *const std::ffi::c_void, *const PROPVARIANT) -> i32,
        Commit: unsafe extern "system" fn(*const std::ffi::c_void) -> i32,
    }
}

#[cfg(not(windows))]
mod inner {
    #[tauri::command]
    pub fn is_vb_cable_installed() -> Result<bool, String> {
        Ok(false)
    }
}

pub use inner::*;