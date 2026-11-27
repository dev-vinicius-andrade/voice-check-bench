// VB-Cable detection: checks whether VB-Audio Virtual Cable is installed
// by enumerating WASAPI audio endpoints and looking for "CABLE" in device names.
// This is a user-mode check — no kernel driver or admin privileges required.

#[cfg(windows)]
mod inner {
    use windows_sys::Win32::Media::Audio::{
        eCapture, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows_sys::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows_sys::Win32::System::Com::StructuredStorage::{
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

    /// Check if VB-Audio Virtual Cable is installed by enumerating active audio endpoints.
    /// Looks for "CABLE" in both render and capture device friendly names.
    #[tauri::command]
    pub fn is_vb_cable_installed() -> Result<bool, String> {
        unsafe {
            // Initialize COM for this thread
            CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED);

            let mut enumerator: *mut IMMDeviceEnumerator = std::ptr::null_mut();
            let hr = CoCreateInstance(
                &CLSID_MM_DEVICE_ENUMERATOR,
                std::ptr::null_mut(),
                CLSCTX_ALL,
                &IMMDeviceEnumerator::IID,
                &mut enumerator as *mut *mut IMMDeviceEnumerator as *mut _,
            );

            if hr < 0 || enumerator.is_null() {
                return Err(format!(
                    "Failed to create device enumerator: HRESULT 0x{:08X}",
                    hr
                ));
            }

            let mut found = false;

            // Check both render and capture endpoints
            for direction in [eRender, eCapture] {
                let mut collection = std::ptr::null_mut();
                let hr = (*enumerator).EnumAudioEndpoints(direction, DEVICE_STATE_ACTIVE, &mut collection);
                if hr < 0 || collection.is_null() {
                    continue;
                }

                let mut count = 0u32;
                let hr = (*collection).GetCount(&mut count);
                if hr < 0 {
                    (*collection).Release();
                    continue;
                }

                for i in 0..count {
                    let mut device = std::ptr::null_mut();
                    let hr = (*collection).Item(i, &mut device);
                    if hr < 0 || device.is_null() {
                        continue;
                    }

                    // Get device properties
                    let mut props = std::ptr::null_mut();
                    let hr = (*device).OpenPropertyStore(0, &mut props);
                    if hr >= 0 && !props.is_null() {
                        let mut var: PROPVARIANT = std::mem::zeroed();
                        let hr = (*props).GetValue(&DEVPKEY_Device_FriendlyName, &mut var);
                        if hr >= 0 {
                            let name_ptr = PropVariantToStringAlloc(&var);
                            if !name_ptr.is_null() {
                                // Convert wide string to Rust string
                                let mut len = 0usize;
                                while *name_ptr.add(len) != 0 {
                                    len += 1;
                                }
                                let name =
                                    String::from_utf16_lossy(std::slice::from_raw_parts(name_ptr, len));

                                // VB-Cable devices contain "CABLE" in their friendly name
                                if name.to_uppercase().contains("CABLE") {
                                    found = true;
                                }

                                CoTaskMemFree(name_ptr as *mut _);
                            }
                            PropVariantClear(&mut var);
                        }
                        (*props).Release();
                    }

                    (*device).Release();
                }

                (*collection).Release();
            }

            (*enumerator).Release();
            Ok(found)
        }
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