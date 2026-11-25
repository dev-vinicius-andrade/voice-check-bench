// Driver installation command: installs the bundled VCB virtual audio capture driver.
// Uses pnputil (built into Windows 10+) to add and install the INF from the app's resources directory.
// Requires admin privileges — the frontend should request elevation before calling this.

#[cfg(windows)]
mod inner {
    use std::path::PathBuf;
    use std::process::Command;
    use tauri::{AppHandle, Manager};

    #[derive(serde::Serialize)]
    pub struct DriverInstallResult {
        pub success: bool,
        pub message: String,
        pub already_installed: bool,
    }

    /// Install the VCB virtual audio capture driver from bundled resources.
    /// Returns success status and whether the driver was already installed.
    #[tauri::command]
    pub fn install_virtual_audio_driver(app: AppHandle) -> Result<DriverInstallResult, String> {
        // Resolve the path to bundled resources
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to resolve resource directory: {}", e))?;

        let inf_path = resource_dir.join("vcb_capture.inf");
        let sys_path = resource_dir.join("vcb_capture.sys");
        let cat_path = resource_dir.join("vcb_capture.cat");

        // Verify bundled files exist
        if !inf_path.exists() {
            return Ok(DriverInstallResult {
                success: false,
                message: format!(
                    "Driver INF not found at {}. The driver files may not be bundled in this build.",
                    inf_path.display()
                ),
                already_installed: false,
            });
        }
        if !sys_path.exists() {
            return Ok(DriverInstallResult {
                success: false,
                message: format!(
                    "Driver SYS not found at {}. The driver binary may not be bundled in this build.",
                    sys_path.display()
                ),
                already_installed: false,
            });
        }

        // Check if driver is already installed by looking for the device
        let check_output = Command::new("pnputil")
            .args(["/enum-devices", "/class", "{4d36e96c-e325-11ce-bfc1-08002be10318}"])
            .output();

        let already_installed = match check_output {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout.contains("Voice Check Bench Mic") || stdout.contains("VCB_Capture")
            }
            Err(_) => false,
        };

        if already_installed {
            return Ok(DriverInstallResult {
                success: true,
                message: "Voice Check Bench Mic driver is already installed.".to_string(),
                already_installed: true,
            });
        }

        // Add the driver package to the driver store
        let add_output = Command::new("pnputil")
            .args([
                "/add-driver",
                &inf_path.to_string_lossy(),
                "/install",
            ])
            .output()
            .map_err(|e| format!("Failed to run pnputil: {}. Is the app running as administrator?", e))?;

        let stdout = String::from_utf8_lossy(&add_output.stdout);
        let stderr = String::from_utf8_lossy(&add_output.stderr);

        if add_output.status.success() {
            Ok(DriverInstallResult {
                success: true,
                message: format!(
                    "Voice Check Bench Mic driver installed successfully.\n{}",
                    stdout.trim()
                ),
                already_installed: false,
            })
        } else {
            // Check if it failed due to missing admin privileges
            let combined = format!("{}{}", stdout, stderr);
            let hint = if combined.contains("access denied") || combined.contains("0x5") {
                " Please restart the app as Administrator."
            } else if combined.contains("not signed") || combined.contains("0x800b0100") {
                " The driver is not signed. Enable test signing: bcdedit /set TESTSIGNING ON"
            } else {
                ""
            };

            Ok(DriverInstallResult {
                success: false,
                message: format!(
                    "Driver installation failed: {}{}",
                    combined.trim(),
                    hint
                ),
                already_installed: false,
            })
        }
    }

    /// Uninstall the VCB virtual audio capture driver.
    #[tauri::command]
    pub fn uninstall_virtual_audio_driver() -> Result<DriverInstallResult, String> {
        let remove_output = Command::new("pnputil")
            .args(["/remove-device", "Root\\VCB_Capture"])
            .output()
            .map_err(|e| format!("Failed to run pnputil: {}", e))?;

        let stdout = String::from_utf8_lossy(&remove_output.stdout);

        if remove_output.status.success() {
            Ok(DriverInstallResult {
                success: true,
                message: format!("Driver removed successfully.\n{}", stdout.trim()),
                already_installed: false,
            })
        } else {
            Ok(DriverInstallResult {
                success: false,
                message: format!("Driver removal failed: {}", stdout.trim()),
                already_installed: false,
            })
        }
    }

    /// Check if the VCB driver is currently installed.
    #[tauri::command]
    pub fn is_virtual_audio_driver_installed() -> Result<bool, String> {
        let output = Command::new("pnputil")
            .args(["/enum-devices", "/class", "{4d36e96c-e325-11ce-bfc1-08002be10318}"])
            .output()
            .map_err(|e| format!("Failed to run pnputil: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.contains("Voice Check Bench Mic") || stdout.contains("VCB_Capture"))
    }
}

#[cfg(not(windows))]
mod inner {
    use serde::Serialize;

    #[derive(Serialize)]
    pub struct DriverInstallResult {
        pub success: bool,
        pub message: String,
        pub already_installed: bool,
    }

    #[tauri::command]
    pub fn install_virtual_audio_driver(_app: tauri::AppHandle) -> Result<DriverInstallResult, String> {
        Ok(DriverInstallResult {
            success: false,
            message: "Virtual audio driver is only supported on Windows.".to_string(),
            already_installed: false,
        })
    }

    #[tauri::command]
    pub fn uninstall_virtual_audio_driver() -> Result<DriverInstallResult, String> {
        Ok(DriverInstallResult {
            success: false,
            message: "Virtual audio driver is only supported on Windows.".to_string(),
            already_installed: false,
        })
    }

    #[tauri::command]
    pub fn is_virtual_audio_driver_installed() -> Result<bool, String> {
        Ok(false)
    }
}

pub use inner::*;