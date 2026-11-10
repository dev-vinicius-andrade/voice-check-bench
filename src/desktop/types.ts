// Desktop (Tauri) bridge contract. Mirrors the Rust structs in desktop/src-tauri/src/lib.rs (serde camelCase).

/** `engine_info` command result. */
export interface EngineInfo {
  appVersion: string
  /** rustc version the engine was built with; absent when the build could not read it. */
  rustVersion?: string | null
  /** std::env::consts::OS, e.g. "windows". */
  os: string
  /** std::env::consts::ARCH, e.g. "x86_64". */
  arch: string
}
