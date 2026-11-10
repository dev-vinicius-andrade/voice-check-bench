// One live update (SPEC "Live tuning (v1.3)"): read the newest audio of both rings over the same stretch of time,
// update the alignment, measure the window, smooth the numbers and derive hints. Framework-free, no browser APIs.
import type { VoiceGoal } from '../types'
import { estimateLag, LagTracker } from './align'
import { liveHints } from './hints'
import { frameLen, liveFrames, type LiveFrames } from './frames'
import { metricsOfFrames, type LiveWindowMetrics } from './metrics'
import type { FloatRing } from './ring'
import { smoothMetrics } from './smooth'
import { LIVE_WINDOW_SEC, type LiveMetrics } from './types'

/** Alignment looks at this much of both inputs every update, seconds. */
export const ALIGN_SEC = 6
/** No metrics until both inputs hold this much audio over the same time, seconds. */
export const MIN_WINDOW_SEC = 0.5

function readEnding(ring: FloatRing, n: number, end: number): Float32Array | null {
  const out = new Float32Array(n)
  return ring.readEnding(out, end) ? out : null
}

/** One update: the metrics, the frames they were measured on and the absolute sample where those frames end. */
export interface LiveStep {
  metrics: LiveMetrics
  frames: LiveFrames
  /** Absolute frame (fx time, the rings' numbering) just after the last analysed sample. */
  end: number
}

export class LiveAnalyzer {
  private readonly tracker = new LagTracker()
  private prev: LiveWindowMetrics | null = null

  /** Forgets the alignment history and the smoothing (call when capture restarts). */
  reset(): void {
    this.tracker.reset()
    this.prev = null
  }

  /** Metrics of the newest window, or null while there is not enough audio yet. raw null = Wave Link output only. */
  update(raw: FloatRing | null, fx: FloatRing, sampleRate: number, goal: VoiceGoal): LiveMetrics | null {
    return this.step(raw, fx, sampleRate, goal)?.metrics ?? null
  }

  /**
   * update() plus the frames behind the metrics (for the running segments). Windows end on the 50 ms frame grid of the
   * absolute frame numbers, so consecutive windows share frame boundaries and the segments can take only the new ones.
   */
  step(raw: FloatRing | null, fx: FloatRing, sampleRate: number, goal: VoiceGoal): LiveStep | null {
    const win = frameLen(sampleRate)
    const end = Math.floor((raw ? Math.min(raw.end, fx.end) : fx.end) / win) * win
    const start = raw ? Math.max(raw.start, fx.start) : fx.start
    const avail = end - start
    if (avail < MIN_WINDOW_SEC * sampleRate) return null
    const winN = Math.round(LIVE_WINDOW_SEC * sampleRate)

    let rawWin: Float32Array | null = null
    let fxWin: Float32Array | null
    let lagMs: number | null = null
    let sync = 0
    if (raw) {
      const n = Math.min(avail, Math.round(ALIGN_SEC * sampleRate))
      const a = readEnding(raw, n, end)
      const b = readEnding(fx, n, end)
      if (!a || !b) return null
      const est = estimateLag(a, b, sampleRate)
      sync = est.sync
      lagMs = this.tracker.push(est)
      // the metric windows are the newest part of the alignment windows; raw reaches back by the lag (fx when ahead)
      const lag = Math.round(((lagMs ?? 0) * sampleRate) / 1000)
      rawWin = a.subarray(n - Math.min(n, winN + Math.max(0, lag)))
      fxWin = b.subarray(n - Math.min(n, winN + Math.max(0, -lag)))
    } else {
      fxWin = readEnding(fx, Math.min(avail, winN), end)
      if (!fxWin) return null
    }

    const frames = liveFrames(rawWin, fxWin, sampleRate, lagMs)
    const smoothed = smoothMetrics(this.prev, metricsOfFrames(frames, goal))
    this.prev = smoothed
    const m: LiveMetrics = { ...smoothed, lagMs, sync, hints: [] }
    m.hints = liveHints(m)
    return { metrics: m, frames, end: end - frames.endTrim }
  }
}
