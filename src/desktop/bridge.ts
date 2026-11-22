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
  RenderStatus,
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

// ---- Offline render session (desktop/src-tauri/src/render): a recorded take through the person's real chain, faster
// than real time, without audio devices. Its own plugin instances: it may run while the engine runs. Commands reject
// with an AudioError ({ code, message }); `notRunning` means no session is open. ----

/** Open the session on the current Wave Link mic chain (Settings.json is only read); replaces an open one. */
export async function renderOpen(): Promise<RenderStatus> {
  return call<RenderStatus>('render_open')
}

/** Same as `audioSetParam`, on the session's chain; applies from the next `renderRun`. */
export async function renderSetParam(slot: number, id: number, value: number): Promise<AudioSlot> {
  return call<AudioSlot>('render_set_param', { slot, id, value })
}

/** Same as `audioSetBypass`, on the session's chain (a bypassed slot adds no delay to the render). */
export async function renderSetBypass(slot: number, bypassed: boolean): Promise<AudioSlot> {
  return call<AudioSlot>('render_set_bypass', { slot, bypassed })
}

/** Same as `audioLoadState`, on the session's chain. */
export async function renderLoadState(slot: number, parameterState: string): Promise<AudioSlot> {
  return call<AudioSlot>('render_load_state', { slot, parameterState })
}

/** Raw response body → samples (an ArrayBuffer; an array of byte values if the IPC fell back to postMessage). */
function toSamples(body: ArrayBuffer | number[]): Float32Array {
  const bytes = Array.isArray(body) ? Uint8Array.from(body) : new Uint8Array(body)
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4))
}

/**
 * Render mono 48 kHz samples through the session's chain. The result has the input's length and lines up with it
 * sample by sample (chain latency removed); the same samples and settings always give the same output. Not clamped:
 * peaks above 1 stay. Samples cross the IPC as raw little-endian f32 bytes (no JSON).
 */
export async function renderRun(samples: Float32Array): Promise<Float32Array> {
  const { invoke } = await import('@tauri-apps/api/core')
  const body = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  return toSamples(await invoke<ArrayBuffer | number[]>('render_run', body))
}

/** Every hosted slot's current state in the session's chain (same shape as `audioExportStates`). */
export async function renderExportStates(): Promise<AudioExportedState[]> {
  return call<AudioExportedState[]>('render_export_states')
}

/** Close the session and unload its plugins (no-op when none is open). */
export async function renderClose(): Promise<void> {
  return call<void>('render_close')
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

/** What saveWav does (screens take a fake in tests; it is not in `desktopBridge`). */
export type SaveWav = (name: string, wav: ArrayBuffer) => Promise<string>

/**
 * Save a finished WAV file (bytes) as `name` (a plain `<name>.wav`) in the Downloads folder; resolves with the full
 * path written (an existing name gets `-2`, `-3`…). Rejects with { code: invalidName | notWav | noFolder | writeFailed,
 * message }. The bytes cross the IPC as the raw body, the name as the `x-file-name` header (desktop/src-tauri/src/download.rs).
 */
export async function saveWav(name: string, wav: ArrayBuffer): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('save_wav', new Uint8Array(wav), { headers: { 'x-file-name': name } })
}

// ---- Actuator discovery (desktop/src-tauri/src/discovery.rs): filesystem-level detection of installed audio software. ----

/** Detected actuator returned by the Rust backend; mirrors `DetectedActuator` in src/desktop/discovery.ts. */
export interface DetectedActuatorBackend {
 id: string
 name: string
 detectedAt: string
 meta?: Record<string, string>
}

/** Scan for installed audio actuators via filesystem checks (works without Wave Link running). */
export async function detectActuators(): Promise<DetectedActuatorBackend[]> {
 return call<DetectedActuatorBackend[]>('detect_actuators')
}

/** The offline render commands in one object; code that renders takes a `RenderBridge` (a fake in tests). */
export const renderBridge = {
  renderOpen,
  renderSetParam,
  renderSetBypass,
  renderLoadState,
  renderRun,
  renderExportStates,
  renderClose,
}

export type RenderBridge = typeof renderBridge

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
  ...renderBridge,
}

/** What screens take (a fake in tests): every command, the render session's included. */
export type DesktopBridge = typeof desktopBridge
