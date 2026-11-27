// VB-Cable detection: checks whether VB-Audio Virtual Cable is installed
// by enumerating WASAPI audio endpoints and looking for "CABLE" in device names.
// This is a user-mode check — no kernel driver or admin privileges required.

#[cfg(windows)]
mod inner {
 use windows_sys::Win32::Media::Audio::{
 IMMDeviceEnumerator, MMDeviceEnumerator, eCapture, eRender, DEVICE_STATE_ACTIVE,
 };
 use windows_sys::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
 use windows_sys::core::GUID;

 // IMMDeviceEnumerator GUID: {BCDE0395-E52F-467C-8E3D-C4579291692E}
 const CLSID_MM_DEVICE_ENUMERATOR: GUID = GUID {
 Data1: 0xBCDE0395,
 Data2: 0xE52F,
 Data3: 0x467C,
 Data4: [0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E],
 };

 /// Check if VB-Audio Virtual Cable is installed by enumerating active audio endpoints.
 /// Looks for "CABLE" in both render and capture device friendly names.
 #[tauri::command]
 pub fn is_vb_cable_installed() -> Result<bool, String> {
 unsafe {
 // Initialize COM for this thread
 windows_sys::Win32::System::Com::CoInitializeEx(
 std::ptr::null_mut(),
 windows_sys::Win32::System::Com::COINIT_APARTMENTTHREADED,
 );

 let enumerator: *mut IMMDeviceEnumerator = std::ptr::null_mut();
 let hr = CoCreateInstance(
 &CLSID_MM_DEVICE_ENUMERATOR,
 std::ptr::null_mut(),
 CLSCTX_ALL,
 &IMMDeviceEnumerator::IID,
 &enumerator as *const *mut IMMDeviceEnumerator as *mut _,
 );

 if hr < 0 || enumerator.is_null() {
 return Err(format!("Failed to create device enumerator: HRESULT 0x{:08X}", hr));
 }

 let mut found = false;

 // Check both render and capture endpoints
 for direction in [eRender, eCapture] {
 let collection = std::ptr::null_mut();
 let hr = (*enumerator).EnumAudioEndpoints(direction, DEVICE_STATE_ACTIVE, &collection);
 if hr < 0 || collection.is_null() {
 continue;
 }

 let count = 0u32;
 let hr = (*collection).GetCount(&count);
 if hr < 0 {
 (*collection).Release();
 continue;
 }

 for i in 0..count {
 let device = std::ptr::null_mut();
 let hr = (*collection).Item(i, &device);
 if hr < 0 || device.is_null() {
 continue;
 }

 // Get device properties
 let props = std::ptr::null_mut();
 let hr = (*device).OpenPropertyStore(0, &props);
 if hr >= 0 && !props.is_null() {
 // PKEY_Device_FriendlyName: {a45c254e-df1c-4efd-8020-67d146a850e0}, pid 14
 use windows_sys::Win32::System::Com::StructuredStorage::{PropVariantToStringAlloc, PROPVARIANT};
 use windows_sys::Win32::Devices::Properties::DEVPKEY_Device_FriendlyName;

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
 let name = String::from_utf16_lossy(std::slice::from_raw_parts(name_ptr, len));

 // VB-Cable devices contain "CABLE" in their friendly name
 if name.to_uppercase().contains("CABLE") {
 found = true;
 }

 windows_sys::Win32::System::Com::CoTaskMemFree(name_ptr as *mut _);
 }
 windows_sys::Win32::System::Com::StructuredStorage::PropVariantClear(&mut var);
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