// Desktop bridge (SPEC "Desktop app (v2.0)"). Framework-free. The Tauri API is imported lazily so the web
// bundle never loads it unless the page runs inside the desktop app.
import { decodeAudioFrame } from './audioFrame'
import type {
  AudioDevices,
  AudioExportedState,
  AudioFrame,
  AudioMonitor,
  AudioSlot,
  AudioStartOptions,
  AudioStatus,
  EngineInfo,
  WlBackupInfo,
  WlChainChange,
  WlDiffLine,
  WlFlowReport,
  WlSnapshot,
} from './types'

/** True inside the Tauri webview (Tauri v2 injects `__TAURI_INTERNALS__`); false on the web and without a window. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return args === undefined ? invoke<T>(cmd) : invoke<T>(cmd, args)
}

/** Version, OS and architecture reported by the Rust engine. */
export async function engineInfo(): Promise<EngineInfo> {
  return call<EngineInfo>('engine_info')
}

// ---- Audio engine (desktop/src-tauri/src/audio). Commands reject with an AudioError ({ code, message }). ----

/** Capture and render devices, with the defaults `audioStart` uses. */
export async function audioDevices(): Promise<AudioDevices> {
  return call<AudioDevices>('audio_devices')
}

/**
 * Start the engine on the current Wave Link mic chain (Settings.json is only read). `onFrame` gets ~10 frames per
 * second of aligned raw/processed audio with meters and counters; frames that fail to decode are dropped.
 */
export async function audioStart(opts: AudioStartOptions, onFrame: (frame: AudioFrame) => void): Promise<AudioStatus> {
  const { Channel } = await import('@tauri-apps/api/core')
  const channel = new Channel<ArrayBuffer>((buf) => {
    const frame = decodeAudioFrame(buf)
    if (frame) onFrame(frame)
  })
  return call<AudioStatus>('audio_start', {
    inputId: opts.inputId ?? null,
    outputId: opts.outputId ?? null,
    monitor: opts.monitor ?? null,
    gainDb: opts.gainDb ?? null,
    onFrame: channel,
  })
}

/** Stop the engine (no-op when it is not running). */
export async function audioStop(): Promise<void> {
  return call<void>('audio_stop')
}

/** Set a plugin parameter (VST3 normalized 0..1, VST2 raw value); returns the slot with its new parameters. */
export async function audioSetParam(slot: number, id: number, value: number): Promise<AudioSlot> {
  return call<AudioSlot>('audio_set_param', { slot, id, value })
}

/** Bypass a slot (Wave Link BypassState and the plugin's own bypass); its latency stays as compensation. */
export async function audioSetBypass(slot: number, bypassed: boolean): Promise<AudioSlot> {
  return call<AudioSlot>('audio_set_bypass', { slot, bypassed })
}

/** Load a Wave Link ParameterState (base64) into a slot; re-read its parameters from the result. */
export async function audioLoadState(slot: number, parameterState: string): Promise<AudioSlot> {
  return call<AudioSlot>('audio_load_state', { slot, parameterState })
}

export async function audioSetMonitor(monitor: AudioMonitor): Promise<void> {
  return call<void>('audio_set_monitor', { monitor })
}

/** Output gain in dB (−120..24). */
export async function audioSetGain(gainDb: number): Promise<void> {
  return call<void>('audio_set_gain', { gainDb })
}

/** The engine's status, or null when it is not running. */
export async function audioStatus(): Promise<AudioStatus | null> {
  return call<AudioStatus | null>('audio_status')
}

/** Every hosted slot's current ParameterState and BypassState, chain order (nothing is written). */
export async function audioExportStates(): Promise<AudioExportedState[]> {
  return call<AudioExportedState[]>('audio_export_states')
}

// ---- Wave Link Settings.json (desktop/src-tauri/src/wavelink). Commands reject with a WlError ({ code, message }). ----

/** Settings.json path, hash and inputs with their effect chains (read-only). */
export async function wavelinkRead(): Promise<WlSnapshot> {
  return call<WlSnapshot>('wavelink_read')
}

/** What `changes` would change in the current file; nothing is written. */
export async function wavelinkPreview(changes: WlChainChange[]): Promise<WlDiffLine[]> {
  return call<WlDiffLine[]>('wavelink_preview', { changes })
}

/**
 * Backup, close Wave Link, write, start it again, verify. `expectedHash` is the hash from `wavelinkRead`; `force`
 * closes Wave Link by force when it does not close by itself (ask the person first).
 */
export async function wavelinkExport(changes: WlChainChange[], expectedHash: string, force: boolean): Promise<WlFlowReport> {
  return call<WlFlowReport>('wavelink_export', { changes, expectedHash, force })
}

/** Backups next to Settings.json, newest first. */
export async function wavelinkBackups(): Promise<WlBackupInfo[]> {
  return call<WlBackupInfo[]>('wavelink_backups')
}

/** Writes a backup back over Settings.json with the export's close/start/verify steps. */
export async function wavelinkRestore(path: string, force: boolean): Promise<WlFlowReport> {
  return call<WlFlowReport>('wavelink_restore', { path, force })
}

/** Every command in one object, so screens can take a fake in tests. */
export const desktopBridge = {
  engineInfo,
  audioDevices,
  audioStart,
  audioStop,
  audioSetParam,
  audioSetBypass,
  audioLoadState,
  audioSetMonitor,
  audioSetGain,
  audioStatus,
  audioExportStates,
  wavelinkRead,
  wavelinkPreview,
  wavelinkExport,
  wavelinkBackups,
  wavelinkRestore,
}

export type DesktopBridge = typeof desktopBridge
