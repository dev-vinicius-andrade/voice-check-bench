// VB-Cable detection: checks whether VB-Audio Virtual Cable is installed
// by querying the Windows registry for its audio endpoint registration.
// This is a simple user-mode check — no COM, no kernel driver, no admin privileges.

#[cfg(windows)]
mod inner {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    /// Check if VB-Audio Virtual Cable is installed by looking for its registry entries.
    #[tauri::command]
    pub fn is_vb_cable_installed() -> Result<bool, String> {
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

        // Strategy 1: Check VB-Audio's own registry key
        let cable_paths = [
            "SOFTWARE\\VB-Audio\\Cable",
            "SOFTWARE\\VB-Audio\\Virtual Cable",
            "SOFTWARE\\WOW6432Node\\VB-Audio\\Cable",
        ];

        for path in &cable_paths {
            if hklm.open_subkey_with_flags(path, KEY_READ).is_ok() {
                return Ok(true);
            }
        }

        // Strategy 2: Check installed driver services
        let driver_paths = [
            "SYSTEM\\CurrentControlSet\\Services\\VBAudioVAC",
            "SYSTEM\\CurrentControlSet\\Services\\VBCable",
            "SYSTEM\\CurrentControlSet\\Services\\vb-audio-cable",
        ];

        for path in &driver_paths {
            if hklm.open_subkey_with_flags(path, KEY_READ).is_ok() {
                return Ok(true);
            }
        }

        // Strategy 3: Check uninstall registry for VB-Cable entry
        let uninstall_paths = [
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ];

        for uninst_path in &uninstall_paths {
            if let Ok(key) = hklm.open_subkey_with_flags(uninst_path, KEY_READ) {
                for subkey_result in key.enum_keys() {
                    if let Ok(name) = subkey_result {
                        let lower = name.to_lowercase();
                        if lower.contains("vb") || lower.contains("cable") {
                            if let Ok(sk) = key.open_subkey_with_flags(&name, KEY_READ) {
                                if let Ok(display_name) = sk.get_value::<String, _>("DisplayName") {
                                    if display_name.to_uppercase().contains("CABLE") {
                                        return Ok(true);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(false)
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