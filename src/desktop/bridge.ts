// Desktop bridge (SPEC "Desktop app (v2.0)"). Framework-free. The Tauri API is imported lazily so the web
// bundle never loads it unless the page runs inside the desktop app.
import type { EngineInfo } from './types'

/** True inside the Tauri webview (Tauri v2 injects `__TAURI_INTERNALS__`); false on the web and without a window. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Version, OS and architecture reported by the Rust engine. */
export async function engineInfo(): Promise<EngineInfo> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<EngineInfo>('engine_info')
}
