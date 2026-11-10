use std::process::Command;

fn main() {
    // Record the compiler version for `engine_info` (optional: absent when rustc can't be run).
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    if let Ok(out) = Command::new(rustc).arg("--version").output() {
        if let Ok(v) = String::from_utf8(out.stdout) {
            println!("cargo:rustc-env=VCB_RUSTC_VERSION={}", v.trim());
        }
    }
    tauri_build::build()
}
