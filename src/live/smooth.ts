// Light smoothing of the numbers live tuning shows (SPEC "Live tuning (v1.3)"). Pure.
// Speech level, pause level and tone follow an exponential moving average so they don't jitter every 500 ms; peaks,
// clipped frames, dead silence and talk time stay as measured. A NaN on either side restarts the average.
import type { LiveWindowMetrics } from './metrics'
import type { LiveSide } from './types'

/** Weight of the newest window. */
export const EMA_ALPHA = 0.4

export const ema = (prev: number, next: number, alpha = EMA_ALPHA): number =>
  Number.isFinite(prev) && Number.isFinite(next) ? prev + alpha * (next - prev) : next

function smoothSide(prev: LiveSide | null, next: LiveSide, alpha: number): LiveSide {
  if (!prev) return next
  return {
    ...next,
    speechDb: ema(prev.speechDb, next.speechDb, alpha),
    pauseDb: ema(prev.pauseDb, next.pauseDb, alpha),
    tone: next.tone.map((v, i) => ema(prev.tone[i] ?? NaN, v, alpha)),
  }
}

/** next with speechDb, pauseDb and tone averaged with prev (the previous smoothed metrics); prev null = first window. */
export function smoothMetrics(prev: LiveWindowMetrics | null, next: LiveWindowMetrics, alpha = EMA_ALPHA): LiveWindowMetrics {
  return {
    talkSec: next.talkSec,
    raw: next.raw ? smoothSide(prev?.raw ?? null, next.raw, alpha) : null,
    fx: smoothSide(prev?.fx ?? null, next.fx, alpha),
  }
}
