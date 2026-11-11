// Live analysis of the engine's stream (SPEC "Desktop app (v2.0)" → Live analysis). Framework-free. The frames are
// already aligned by the chain latency, so the windows are measured with lag 0 (no LagTracker); hold, history and
// segments come from the shared LiveTracker. Times are ms of audio received since Start (the stream clock).
import { liveHints } from '../live/hints'
import { frameLen, liveFrames } from '../live/frames'
import { metricsOfFrames, type LiveWindowMetrics } from '../live/metrics'
import { FloatRing } from '../live/ring'
import { smoothMetrics } from '../live/smooth'
import { LiveTracker, type LiveUpdate } from '../live/tracker'
import { LIVE_BUFFER_SEC, LIVE_UPDATE_MS, LIVE_WINDOW_SEC, type LiveMetrics } from '../live/types'
import { MIN_WINDOW_SEC } from '../live/analyzer'
import type { Msg } from '../plain/types'
import type { VoiceGoal } from '../types'
import type { AudioFrame } from './types'

export class DesktopLiveFeed {
  private sampleRate = 0
  private raw = new FloatRing(1)
  private fx = new FloatRing(1)
  private readonly tracker = new LiveTracker()
  private prev: LiveWindowMetrics | null = null
  private sinceUpdate = 0

  /** Forgets everything (Start). */
  reset(): void {
    this.sampleRate = 0
    this.prev = null
    this.sinceUpdate = 0
    this.tracker.reset(0)
  }

  /** ms of audio received since Start. */
  get nowMs(): number {
    return this.sampleRate ? (this.fx.end / this.sampleRate) * 1000 : 0
  }

  /** Adds one stream frame; every LIVE_UPDATE_MS of audio returns a new update (null in between). */
  push(frame: AudioFrame, goal: VoiceGoal): LiveUpdate | null {
    const sr = frame.sampleRate
    if (sr !== this.sampleRate) {
      this.sampleRate = sr
      this.raw = new FloatRing(LIVE_BUFFER_SEC * sr)
      this.fx = new FloatRing(LIVE_BUFFER_SEC * sr)
      this.sinceUpdate = 0
    }
    this.raw.write(frame.raw)
    this.fx.write(frame.processed)
    this.sinceUpdate += frame.processed.length
    if (this.sinceUpdate < (LIVE_UPDATE_MS * sr) / 1000) return null
    this.sinceUpdate = 0
    return this.update(goal)
  }

  private update(goal: VoiceGoal): LiveUpdate | null {
    const sr = this.sampleRate
    const win = frameLen(sr)
    const end = Math.floor(this.fx.end / win) * win
    const avail = end - this.fx.start
    if (avail < MIN_WINDOW_SEC * sr) return null
    const n = Math.floor(Math.min(avail, LIVE_WINDOW_SEC * sr) / win) * win
    const rawWin = new Float32Array(n)
    const fxWin = new Float32Array(n)
    if (!this.raw.readEnding(rawWin, end) || !this.fx.readEnding(fxWin, end)) return null
    const frames = liveFrames(rawWin, fxWin, sr, 0)
    const smoothed = smoothMetrics(this.prev, metricsOfFrames(frames, goal))
    this.prev = smoothed
    const m: LiveMetrics = { ...smoothed, lagMs: 0, sync: 1, hints: [] }
    m.hints = liveHints(m)
    return this.tracker.update(m, { frames, end }, (end / sr) * 1000, goal)
  }

  /** A setting changed now: a new segment and a history marker. */
  markChange(label: Msg): void {
    this.tracker.markChange(label, this.nowMs)
  }

  report(goal: VoiceGoal): Pick<LiveUpdate, 'segments' | 'sinceStart'> {
    return this.tracker.report(goal)
  }
}
