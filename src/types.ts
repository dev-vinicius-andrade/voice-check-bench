// Shared domain types. Owned by the orchestrator; change only with a matching SPEC update.
import type { Msg } from './plain/types'

export type StepKey = 'c2' | 'c8' | 'c15' | 'fx'
export type DeviceKind = 'raw' | 'fx'
export type Status = 'good' | 'warn' | 'bad'
export type ChartView = 'a' | 'ab' | 'diff'
/** Wizard screens (setup/step/results) plus content pages. Hash routes: #/ home, #/how-it-works, #/community, #/privacy, #/check (setup/step), #/results, #/guide. */
export type Screen = 'home' | 'how' | 'community' | 'privacy' | 'setup' | 'step' | 'results' | 'guide'
/** Index into STEPS, or 'free' for a free take. */
export type StepRef = number | 'free'

export interface HumPeak {
  hz: number
  /** dB above the median of neighbouring bins in the silence window. */
  db: number
}

export interface Analysis {
  sampleRate: number
  duration: number
  peak: number
  clip: number
  noise: number
  noiseFromQuiet: boolean
  quietBroken: boolean
  speechMed: number
  speechP90: number
  speechMax: number
  snr: number
  spread: number
  /** Octave band energy in dB relative to the 640–1250 Hz band, one per BANDS entry. */
  rel: number[]
  hum: HumPeak[]
  sibMed: number
  sibP95: number
  // ---- noisy-room diagnosis (empty arrays / NaN when the take has no usable silence window) ----
  /** Average speech power per BANDS entry, dB (same scale as noiseBands, so they can be subtracted). */
  speechBands: number[]
  /** Average noise power per BANDS entry from the silence window, dB. */
  noiseBands: number[]
  /** speechBands - noiseBands per band: where the voice beats the room (> 20 good, < 10 noise wins). */
  bandSnr: number[]
  /** Steady tonal peaks in the silence window (fans, servers, whine), strongest first, at most 6. */
  tones: NoiseTone[]
  noiseKind: NoiseKind
  // ---- over-processing signals (v0.8) ----
  /** Share of samples inside runs of exact zeros lasting ≥ 10 ms (digital silence from a gate or noise remover; isolated quantization zeros don't count). 0..1 */
  zeroRatio: number
  /** Zero-sample runs ≥ 20 ms that start, per 10 s (each start = the processing slammed shut): high = choppy. */
  gateSwitches: number
}

export interface NoiseTone {
  hz: number
  /** dB above the local median of the noise spectrum. */
  db: number
}

/** quiet: noise < -60 dBFS or SNR >= 30. hum: mains peaks dominate. tonal: fan/server tones. broadband: air, hiss, fans without clear tones. */
export type NoiseKind = 'quiet' | 'hum' | 'tonal' | 'broadband'

export interface AnalysisError {
  error: string
}

export type AnalysisResult = Analysis | AnalysisError

export const isAnalysisError = (a: AnalysisResult): a is AnalysisError => 'error' in a

export type CheckId =
  | 'level' | 'peaks' | 'noise' | 'silence' | 'hum'
  | 'rumble' | 'boom' | 'warmth' | 'mud' | 'body' | 'definition' | 'presence' | 'sibilance' | 'air'
  | 'harsh' | 'consistency' | 'tones' | 'bandsnr' | 'overprocessed'

/** One diagnosis line. Text is message keys (`engine.check.*`); numbers travel as params and are formatted by the UI. */
export interface Check {
  id: CheckId
  status: Status
  titleMsg: Msg
  /** The measured value, e.g. "-27.4 dBFS median". */
  valueMsg?: Msg
  detailMsg: Msg
  /** What to try; absent when status is good. */
  fixMsg?: Msg
}

export type MicKind = 'dynamic' | 'condenser' | 'unknown'
export type MicPattern = 'cardioid' | 'supercardioid' | 'omni' | 'figure8' | 'unknown'
export type MicAddress = 'end' | 'side' | 'unknown'

/** The person's microphone. Free-text model (e.g. "Fifine K688", "Shure SM7B") plus the traits that change advice. */
export interface MicProfile {
  model: string
  kind: MicKind
  pattern: MicPattern
  /** end = speak into the top (most dynamics like SM58/K688); side = speak into the side (SM7B, many condensers). */
  address: MicAddress
}

/** What is persisted in IndexedDB (analysis is recomputed on load). */
export interface StoredTake {
  id: number
  name: string
  session: string
  step: StepKey | null
  device: string
  sampleRate: number
  samples: Float32Array
  created: string
  /** Mic profile at record time (absent on takes recorded before v0.2). */
  mic?: MicProfile
}

export interface Take extends StoredTake {
  analysis: AnalysisResult
}

export interface Band {
  lo: number
  hi: number
  name: string
  label: string
  ref: number
}

export interface StepDef {
  key: StepKey
  kind: string
  cm: number | null
  dist: string | null
  dev: DeviceKind
  title: string
  head: string
  lead: string
}

export interface EqBand {
  /** 'Band' with a narrow bandwidth (< 0.3 oct) and a deep cut is a notch for a fan/server tone. */
  type: 'Low Shelf' | 'Band' | 'High Shelf'
  freq: number
  gain: number
  bw: number
  why: string
  /** A gentle tweak for something the person hears but the measurement doesn't confirm (v0.9); absent otherwise. */
  byEar?: boolean
}

/** EqBand as the app holds it: the reason is a message key (exports turn it back into English text). */
export type SuggestedEqBand = Omit<EqBand, 'why'> & { why: Msg }

export interface Suggestion {
  base: Take
  /** Raise/lower the gain first; null when the level is fine. */
  gainHint: Msg | null
  /** Sentences shown together (join with a space); empty unless the room/input noise is too close to the voice for the gate and EQ to help. */
  noiseHint: Msg[]
  dist: string
  lowcut: 80 | 120
  gate: { threshold: number; attack: number; hold: number; release: number; hysteresis: number; wet: number; dry: number }
  eq: SuggestedEqBand[]
  comp: { threshold: number; ratio: number; attack: number; release: number; knee: number; wet: number; limit: boolean }
  deess: boolean
  /** True when SNR < 25 dB: the chain becomes noise reduction → EQ → compressor → soft gate. */
  noisyRoom: boolean
  /** Noise-reduction plugin to add first in the chain (manual setup: profiles can't be written to Wave Link). Null when the room is quiet. */
  noiseReduction: NoiseReductionGuide | null
  /** Ordered chain to set up in Wave Link, e.g. ['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate']. */
  chain: string[]
}

/** NoiseReductionPlan as the app holds it: steps and alternatives are message keys. */
export interface NoiseReductionGuide {
  plugin: 'ReaFIR'
  steps: Msg[]
  alternatives: Msg[]
  /** True when voice and room are so close (SNR < 15) that AI noise removal should be tried before ReaFIR. */
  preferAi: boolean
}

/** Exported (English) form of the noise-reduction plan, as written to the settings JSON and community summaries. */
export interface NoiseReductionPlan {
  plugin: 'ReaFIR'
  /** Step-by-step instructions (mode Subtract, capture profile while silent, reduction amount, FFT size). */
  steps: string[]
  /** Other options if ReaFIR is not wanted (Elgato Noise Removal, Voice Focus, NVIDIA Broadcast). */
  alternatives: string[]
  preferAi?: boolean
}

export interface DeviceChoice {
  raw: string | null
  fx: string | null
}

// ---- Voice goals (v0.9, SPEC "Voice goals") ----
export type VoiceStyle = 'natural' | 'warm' | 'clear' | 'bright'
export type PerceivedIssue = 'nasal' | 'muffled' | 'boomy' | 'thin' | 'harsh' | 'sharpS' | 'dull'
/** What the person wants and what they hear. Saved in localStorage 'vcb-goal'. */
export interface VoiceGoal {
  style: VoiceStyle
  perceived: PerceivedIssue[]
}
export const DEFAULT_GOAL: VoiceGoal = { style: 'natural', perceived: [] }
