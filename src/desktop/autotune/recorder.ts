// Collects the engine's raw stream into one take (SPEC "Tune from a recording — screen", step 1). Framework-free.
// The take is QUIET_SEC of room noise, then talking, RECORD_SEC in all; the stream's counters tell when audio was
// lost on the way (a gap means the take is not one continuous recording).
import { QUIET_SEC } from '../../audio/reference'
import type { AudioFrame } from '../types'
import { TUNE_SAMPLE_RATE } from '../tune/measure'

/** The whole take: QUIET_SEC quiet, then about 22 s of talking. Recording stops by itself here. */
export const RECORD_SEC = 25
/** "Stop" is offered from here on. */
export const MIN_STOP_SEC = 12
export { QUIET_SEC }

export type PushResult = 'recording' | 'full' | 'gap'

export class TakeRecorder {
  private readonly chunks: Float32Array[] = []
  private length = 0
  private dropped: number | null = null
  private overruns: number | null = null
  private broken = false
  readonly sampleRate: number
  readonly max: number

  constructor(sampleRate = TUNE_SAMPLE_RATE, seconds = RECORD_SEC) {
    this.sampleRate = sampleRate
    this.max = Math.round(seconds * sampleRate)
  }

  /** Adds a frame's raw samples (up to RECORD_SEC). 'gap' once frames were dropped or the input overran. */
  push(f: AudioFrame): PushResult {
    if (this.broken) return 'gap'
    const { streamDropped, inputOverruns } = f.counters
    if (this.dropped === null || this.overruns === null) {
      this.dropped = streamDropped
      this.overruns = inputOverruns
    } else if (streamDropped > this.dropped || inputOverruns > this.overruns) {
      this.broken = true
      return 'gap'
    }
    const room = this.max - this.length
    if (room > 0) {
      const part = f.raw.length > room ? f.raw.slice(0, room) : f.raw.slice()
      this.chunks.push(part)
      this.length += part.length
    }
    return this.length >= this.max ? 'full' : 'recording'
  }

  get seconds(): number {
    return this.length / this.sampleRate
  }

  get gap(): boolean {
    return this.broken
  }

  /** Everything collected so far as one buffer. */
  take(): Float32Array {
    const out = new Float32Array(this.length)
    let at = 0
    for (const c of this.chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
}
