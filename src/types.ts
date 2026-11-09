// Shared domain types. Owned by the orchestrator; change only with a matching SPEC update.

export type StepKey = 'c2' | 'c8' | 'c15' | 'fx'
export type DeviceKind = 'raw' | 'fx'
export type Status = 'good' | 'warn' | 'bad'
export type ChartView = 'a' | 'ab' | 'diff'
export type Screen = 'setup' | 'step' | 'results'
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
}

export interface AnalysisError {
  error: string
}

export type AnalysisResult = Analysis | AnalysisError

export const isAnalysisError = (a: AnalysisResult): a is AnalysisError => 'error' in a

export type CheckId =
  | 'level' | 'peaks' | 'noise' | 'silence' | 'hum'
  | 'rumble' | 'boom' | 'warmth' | 'mud' | 'body' | 'definition' | 'presence' | 'sibilance' | 'air'
  | 'harsh' | 'consistency'

export interface Check {
  id: CheckId
  status: Status
  title: string
  value: string
  detail: string
  /** Empty when status is good. */
  fix: string
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
  type: 'Low Shelf' | 'Band' | 'High Shelf'
  freq: number
  gain: number
  bw: number
  why: string
}

export interface Suggestion {
  base: Take
  gainHint: string
  /** Non-empty when the room/input noise is too close to the voice for the gate and EQ to help. */
  noiseHint: string
  dist: string
  lowcut: 80 | 120
  gate: { threshold: number; attack: number; hold: number; release: number; hysteresis: number; wet: number; dry: number }
  eq: EqBand[]
  comp: { threshold: number; ratio: number; attack: number; release: number; knee: number; wet: number; limit: boolean }
  deess: boolean
}

export interface DeviceChoice {
  raw: string | null
  fx: string | null
}
