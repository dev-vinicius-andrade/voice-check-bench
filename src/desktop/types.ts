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

// ---- Audio engine (desktop/src-tauri/src/audio, PLAN task 39) ----

/** `audio_*` command error: stable `code`, `message` for logs (audio/error.rs). */
export interface AudioError {
  code:
    | 'notRunning'
    | 'alreadyRunning'
    | 'noDevice'
    | 'deviceNotFound'
    | 'unsupportedFormat'
    | 'streamFailed'
    | 'settings'
    | 'chain'
    | 'invalidArgument'
    | 'queueFull'
  message: string
}

/** A WASAPI capture or render endpoint (audio/devices.rs). */
export interface AudioDevice {
  /** cpal id ("wasapi:…"), stable across runs; pass it to `audioStart`. */
  id: string
  name: string
  /** The Windows default device for its direction. */
  isSystemDefault: boolean
}

/** `audio_devices` result. The default ids are what `audioStart` opens when no id is given. */
export interface AudioDevices {
  inputs: AudioDevice[]
  outputs: AudioDevice[]
  defaultInputId: string | null
  defaultOutputId: string | null
}

/** What the monitor output plays. `raw` is delayed by the chain latency, so A/B keeps the timing. */
export type AudioMonitor = 'processed' | 'raw' | 'off'

/** Slot status (chain.rs SlotStatus). */
export type SlotStatus =
  | { status: 'hosted'; kind: 'vst2' | 'vst3'; pluginId: string; hasOwnBypass: boolean }
  | { status: 'builtIn' }
  | { status: 'loadFailed'; error: string }

/** One plugin parameter (host/mod.rs ParamInfo). VST3: normalized 0..1; VST2: the raw getParameter value. */
export interface ParamInfo {
  id: number
  name: string
  display: string
  normalized: number
  isBypass: boolean
}

/** A chain slot with its parameters (audio/types.rs AudioSlot = chain.rs SlotInfo + params). */
export interface AudioSlot {
  index: number
  name: string
  filePath: string
  status: SlotStatus
  /** Wave Link BypassState. */
  bypassed: boolean
  /** Delay the slot adds right now. */
  latencySamples: number
  /** Delay while processing; kept as compensation while bypassed. */
  fullLatencySamples: number
  params: ParamInfo[]
}

/** `audio_export_states` item (chain.rs ExportedState): a hosted slot's current state, ready to write to Wave Link. */
export interface AudioExportedState {
  index: number
  name: string
  filePath: string
  /** Wave Link BypassState; a VST3 plugin's own bypass inside `parameterState` follows it. */
  bypassed: boolean
  /** Base64 ParameterState as the plugin saves it now. */
  parameterState: string
}

/** The Wave Link input whose chain runs (Settings.json, read-only). */
export interface ChainSource {
  settingsPath: string
  inputKey: string
  inputLabel: string
}

/** Engine counters (audio/stats.rs CountersSnapshot). */
export interface AudioCounters {
  blocks: number
  inputOverruns: number
  outputUnderruns: number
  monitorDropped: number
  streamDropped: number
  streamErrors: number
  processP50Us: number
  processP99Us: number
  processMaxUs: number
  /** Real-time budget of one block, µs (10 000). */
  blockUs: number
}

/** `audio_start` / `audio_status` result (audio/types.rs AudioStatus). */
export interface AudioStatus {
  source: ChainSource | null
  input: AudioDevice
  output: AudioDevice
  sampleRate: number
  blockSize: number
  monitor: AudioMonitor
  gainDb: number
  latency: {
    /** Constant chain latency (bypassed slots included); raw is delayed by it. */
    alignedSamples: number
    /** What the processing slots add right now; the rest is compensation. */
    activeSamples: number
  }
  /** False for 120 ms after a VST3 state or bypass change. */
  settled: boolean
  slots: AudioSlot[]
  counters: AudioCounters
  lastStreamError: string | null
}

/** `audioStart` options; every field is optional. */
export interface AudioStartOptions {
  inputId?: string
  outputId?: string
  /** Defaults to 'off'. */
  monitor?: AudioMonitor
  /** Defaults to −10 dB; accepted range −120..24. */
  gainDb?: number
}

/** One stream message (~100 ms): aligned raw and processed audio, meters and counters (audio/frame.rs). */
export interface AudioFrame {
  seq: number
  sampleRate: number
  /** Delay already applied to `raw` so it lines up sample by sample with `processed`. */
  latencySamples: number
  /** Every block was processed with the chain settled. */
  settled: boolean
  /** The alignment latency moved inside this frame (a state load changed it). */
  latencyChanged: boolean
  rawRmsDb: number
  rawPeakDb: number
  processedRmsDb: number
  processedPeakDb: number
  counters: Omit<AudioCounters, 'blockUs'>
  raw: Float32Array
  processed: Float32Array
}

// ---- Wave Link file (desktop/src-tauri/src/wavelink, PLAN task 40). Commands reject with a WlError ({ code, message }). ----

/** `wavelink_*` command error (wavelink/error.rs WlErrorCode). */
export interface WlError {
  code:
    | 'notFound'
    | 'parse'
    | 'changedMeanwhile'
    | 'missingEntry'
    | 'invalidChange'
    | 'closeTimeout'
    | 'writeFailed'
    | 'startFailed'
    | 'verifyFailed'
  message: string
}

/** One effect of an input's chain (wavelink/model.rs ChainEntry). */
export interface WlChainEntry {
  index: number
  id: string
  name: string
  vendor: string
  filePath: string
  pluginId: string
  /** Wave Link BypassState (true = switched off). */
  bypassed: boolean
  /** Base64 ParameterState as stored ('' for Wave Link's built-in effects). */
  parameterState: string
}

export interface WlChainInput {
  key: string
  label: string
  entries: WlChainEntry[]
}

/** `wavelink_read` result: the file, its hash (pass it back to export) and the inputs, likely mic first. */
export interface WlSnapshot {
  path: string
  hash: string
  inputs: WlChainInput[]
}

/** One change to an effect of an input's chain (wavelink/edit.rs ChainChange); at least one of the two fields set. */
export interface WlChainChange {
  inputKey: string
  index: number
  parameterState?: string
  bypassed?: boolean
}

/** One changed field (wavelink/edit.rs DiffLine). `from`/`to` are short values ("on"/"off", "changed (N bytes)"). */
export interface WlDiffLine {
  inputKey: string
  input: string
  index: number
  plugin: string
  field: 'parameterState' | 'bypass' | 'chain'
  from: string
  to: string
  fromBytes?: number
  toBytes?: number
}

/** A `Settings.before-*.json` backup next to Settings.json (wavelink/files.rs BackupInfo). */
export interface WlBackupInfo {
  path: string
  name: string
  modifiedMs: number
  size: number
}

export type WlFlowStep = 'checked' | 'backedUp' | 'closed' | 'forced' | 'written' | 'started' | 'verified'

/** What an export or restore did (wavelink/export.rs FlowReport). */
export interface WlFlowReport {
  path: string
  backupPath: string | null
  extraBackupPath: string | null
  wasRunning: boolean
  forced: boolean
  restarted: boolean
  written: boolean
  restoredFrom: string | null
  changes: WlDiffLine[]
  /** SHA-256 of Settings.json after the flow. */
  hash: string
  steps: WlFlowStep[]
}
