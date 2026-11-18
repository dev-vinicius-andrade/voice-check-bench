// Contract of the live noise calibration (SPEC "Calibrate noise live"). Framework-free.
import type { Msg } from '../../plain/types'
import type { Advice } from '../advice/types'

/** What the calibration reads of one engine stream frame (../types.ts AudioFrame has all of it). */
export interface CalStreamFrame {
  seq: number
  sampleRate: number
  /** Every block was processed with the chain settled (a VST3 change settles for 120 ms). */
  settled: boolean
  /** The alignment latency moved inside this frame: raw and processed do not line up there. */
  latencyChanged: boolean
  counters: { streamDropped: number; inputOverruns: number }
  raw: Float32Array
  processed: Float32Array
}

/**
 * idle → quiet (the room, ~5 s) → set (changes, each measured on the pauses) → talk (the words, ~10 s) → done; a
 * More / Less nudge from done → verify (the words again) → done. stopped: the engine stopped under it.
 */
export type CalPhase = 'idle' | 'quiet' | 'set' | 'talk' | 'done' | 'verify'

/**
 * A change for the live chain. `set`: the calibration's one entry for `target` (`<slot>:<key>`, `<slot>:on` for a
 * switch) now goes to the change's value (`from` is the value before the calibration); `revert`: that entry goes away,
 * the value before the calibration comes back.
 */
export type CalCommand = { kind: 'set'; target: string; change: Advice } | { kind: 'revert'; target: string }

/** The result, after the talk check (and after each nudge). */
export interface CalSummary {
  /** The room on the raw mic, dBFS. */
  roomDb: number
  /** The pauses as heard before the calibration and now, dBFS (digital silence reads −100). */
  beforeDb: number
  afterDb: number
  silent: boolean
  /** Each value the calibration moved, from before it to now (exact change lines). */
  changes: Msg[]
  /** The last talk check: speech cut (share 0..1, events per 10 s; NaN before one), room pumping, dB. */
  cutShare: number
  cutEvents: number
  pumpDb: number
  notes: Msg[]
}

/** What the screen shows. */
export interface CalView {
  phase: CalPhase
  /** What to do now ("Stay quiet", "Now talk normally"). */
  instruction: Msg | null
  /** Why a phase started over, or what is waiting. */
  notice: Msg | null
  /** The change being measured (set phase). */
  detail: Msg | null
  /** Share of the current phase done, 0..1; NaN while waiting for a change to settle. */
  progress: number
  /** Seconds left in the current phase, NaN when it waits for the person. */
  leftSec: number
  /** Last 50 ms on the raw mic and as heard, dBFS. */
  rawDb: number
  processedDb: number
  summary: CalSummary | null
  canMore: boolean
  canLess: boolean
}
