// The spectrum of a recorded take, for the result step's plot (SPEC "Tune from a recording — spectrum"). Framework-free.
// CONTRACT: the signatures and their meaning are fixed (the result step's hooks are written against them).
// The live analyzer's own parts run over the whole take once: the plot's FFT frames (display.ts), smoothed frame by
// frame as the live plot would have shown them while the take played, and the steady-tone tracker (tones.ts) with a
// window as long as the take.
import { mergeTones } from './analyzer'
import { DISPLAY_FFT, DISPLAY_HOP, DisplaySpectrum, spectrumFreqs } from './display'
import { FLOOR_DB, Framer } from './framer'
import { ToneTracker } from './tones'
import type { LiveSpectrum, SpectrumAnalyzer, SpectrumTone } from './types'

export interface TakeAnalyzer extends SpectrumAnalyzer {
  /**
   * What `read()` shows: null (the default) = the average of the whole take; a position in seconds = the spectrum
   * around that position (about one second, smoothed like the live plot), for the player while it plays.
   */
  seek(sec: number | null): void
}

/** One signal of the take, analysed. */
interface Side {
  /** The plot points of the take's average power spectrum (read unsmoothed), dBFS. */
  average: Float32Array
  /** The smoothed plot points after each display frame, frame after frame (frames × points). */
  frames: Float32Array
}

/** Display frames of `n` samples: frame i covers the DISPLAY_FFT samples that end at DISPLAY_FFT + i × DISPLAY_HOP. */
const frameCount = (n: number): number => (n >= DISPLAY_FFT ? Math.floor((n - DISPLAY_FFT) / DISPLAY_HOP) + 1 : 0)

function analyseSide(x: Float32Array, n: number, freqsHz: Float32Array, sampleRate: number, tones: ToneTracker): Side {
  const points = freqsHz.length
  const count = frameCount(n)
  const frames = new Float32Array(count * points).fill(FLOOR_DB)
  const sum = new Float64Array(DISPLAY_FFT / 2 + 1)
  const display = new DisplaySpectrum(freqsHz, sampleRate)
  let i = 0
  const framer = new Framer(DISPLAY_FFT, DISPLAY_HOP, (p) => {
    for (let k = 0; k < p.length; k++) sum[k] += p[k]
    display.pushPower(p)
    if (i < count) frames.set(display.db, i * points)
    i++
  })
  framer.push(x, n)
  tones.push(x, n)
  // the average power read by the plot's points as one frame (the first frame of a fresh spectrum is not smoothed)
  const average = new Float32Array(points).fill(FLOOR_DB)
  if (i > 0) {
    for (let k = 0; k < sum.length; k++) sum[k] /= i
    const avg = new DisplaySpectrum(freqsHz, sampleRate)
    avg.pushPower(sum)
    average.set(avg.db)
  }
  return { average, frames }
}

/**
 * A SpectrumAnalyzer over a whole take: `raw` (the take) and `processed` (its render, same length, aligned).
 * `read().tones` are the steady tones of the WHOLE take (present nearly all of it, speech or not; same rules and
 * limits as the live tone tracker), whatever the position. `push` and `reset` do nothing. The work is done once at
 * creation (a 25 s take must take well under a second) or lazily on first read.
 */
export function createTakeAnalyzer(raw: Float32Array, processed: Float32Array, sampleRate = 48000): TakeAnalyzer {
  const freqsHz = spectrumFreqs()
  const points = freqsHz.length
  const n = Math.min(raw.length, processed.length)
  const empty = new Float32Array(points).fill(FLOOR_DB)
  const out: LiveSpectrum = { freqsHz, rawDb: empty, processedDb: empty, tones: [] }
  let done: { raw: Side; processed: Side; tones: SpectrumTone[]; count: number } | null = null
  let at: number | null = null

  const work = (): NonNullable<typeof done> => {
    if (done) return done
    if (!(sampleRate > 0)) {
      done = { raw: { average: empty, frames: empty }, processed: { average: empty, frames: empty }, tones: [], count: 0 }
      return done
    }
    // the tone window holds the whole take: a tone must be present in nearly all of it, not only in its last 10 s
    const windowSec = n / sampleRate + 1
    const rawTones = new ToneTracker(sampleRate, windowSec)
    const processedTones = new ToneTracker(sampleRate, windowSec)
    done = {
      raw: analyseSide(raw, n, freqsHz, sampleRate, rawTones),
      processed: analyseSide(processed, n, freqsHz, sampleRate, processedTones),
      tones: mergeTones(rawTones, processedTones),
      count: frameCount(n),
    }
    return done
  }

  const show = (): void => {
    const w = work()
    out.tones = w.tones
    if (at === null || w.count === 0) {
      out.rawDb = w.raw.average
      out.processedDb = w.processed.average
      return
    }
    // the latest frame that ended by this position: what the live plot showed when the take got there
    const i = Math.min(w.count - 1, Math.max(0, Math.floor((at * sampleRate - DISPLAY_FFT) / DISPLAY_HOP)))
    out.rawDb = w.raw.frames.subarray(i * points, (i + 1) * points)
    out.processedDb = w.processed.frames.subarray(i * points, (i + 1) * points)
  }

  return {
    push: () => undefined,
    reset: () => undefined,
    read(): LiveSpectrum {
      show()
      return out
    },
    seek(sec: number | null): void {
      at = sec === null || !Number.isFinite(sec) ? null : Math.max(0, sec)
    },
  }
}
