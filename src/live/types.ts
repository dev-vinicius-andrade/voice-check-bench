// Live tuning contract (SPEC "Live tuning (v1.3)"). Owned by the orchestrator: the engine task (src/live/*.ts)
// and the UI task (src/components/live/*) both build against this file. Framework-free.
import type { Msg } from '../plain/types'

/** Sliding analysis window, seconds. */
export const LIVE_WINDOW_SEC = 4
/** How often metrics are recomputed, ms. */
export const LIVE_UPDATE_MS = 500
/** Ring buffer length per input, seconds (window + room for the alignment search). */
export const LIVE_BUFFER_SEC = 8
/** Largest delay between the raw mic and the Wave Link output the alignment searches, ms. */
export const LIVE_MAX_LAG_MS = 500

export type LiveStatus = 'idle' | 'starting' | 'running' | 'error'

/** Why live capture could not start or stopped (Msg keys under live.error.*). */
export type LiveError = 'unsupported' | 'permission' | 'rawUnavailable' | 'fxUnavailable' | 'sameDevice' | 'other'

/** Per-input numbers for the last window. NaN when not measurable (no speech, no pause in the window). */
export interface LiveSide {
  /** Median 50 ms frame level while talking, dBFS. */
  speechDb: number
  /** Highest sample in the window, dBFS. */
  peakDb: number
  /** Number of 50 ms frames in the window whose peak reached −1 dBFS. */
  clipFrames: number
  /** Median frame level during pauses, dBFS (the room noise you hear between words). */
  pauseDb: number
  /** Share of the window that is exact digital silence (zero runs ≥ 10 ms), 0..1. */
  deadSilence: number
  /** Deviation from the person's goal per BANDS entry (targetDeviations of the speech frames' spectrum), dB. */
  tone: number[]
}

export interface LiveMetrics {
  /** Seconds of speech in the window (talk frames per the raw input, or the fx input when there is no raw). */
  talkSec: number
  /** Raw mic; null when only the Wave Link output is open. */
  raw: LiveSide | null
  /** Wave Link output (with effects). */
  fx: LiveSide
  /** Estimated delay of fx behind raw, ms; null without raw or before the first confident estimate. */
  lagMs: number | null
  /** Alignment confidence 0..1 (normalized cross-correlation peak of the level envelopes). */
  sync: number
  /** Plain hints, most important first (at most 4). Msg keys under live.hint.*. */
  hints: Msg[]
}

/** What the UI hands the engine to start. */
export interface LiveConfig {
  /** Raw mic deviceId, or null to run on the Wave Link output only. */
  rawId: string | null
  fxId: string
}

/** Thrown by LiveSession.start(). */
export class LiveStartError extends Error {
  readonly code: LiveError
  constructor(code: LiveError, message: string = code) {
    super(message)
    this.code = code
    this.name = 'LiveStartError'
  }
}

/** Implemented by src/live/LiveSession.ts (engine task); used by the UI through a hook. */
export interface LiveSessionApi {
  /** Opens both inputs (fx only when rawId is null) and starts emitting metrics every LIVE_UPDATE_MS. */
  start(cfg: LiveConfig): Promise<void>
  /** Stops capture and releases both microphones. Safe to call twice. */
  stop(): void
  /** Called with fresh metrics every LIVE_UPDATE_MS while running. Returns an unsubscribe function. */
  subscribe(fn: (m: LiveMetrics) => void): () => void
}
