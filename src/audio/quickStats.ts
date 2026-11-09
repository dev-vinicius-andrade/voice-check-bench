// Cheap level summary of a raw take, used to explain a failed analysis. Pure, no React.
import { adb, median, pct } from './dsp'
import { QUIET_SEC } from './reference'

export interface QuickStats {
  duration: number
  /** Peak sample level, dBFS. */
  peakDb: number
  /** Median 50 ms frame level during the silence window (0.6 s – QUIET_SEC), dBFS. */
  silenceDb: number
  /** 90th percentile 50 ms frame level after the countdown, dBFS (the loud parts of the reading). */
  readingDb: number
}

export function quickStats(samples: Float32Array, sampleRate: number): QuickStats {
  const win = Math.round(0.05 * sampleRate)
  const frames: number[] = []
  let peak = 0
  for (let f = 0; (f + 1) * win <= samples.length; f++) {
    let s = 0
    for (let i = f * win; i < (f + 1) * win; i++) {
      const v = samples[i]
      s += v * v
      if (Math.abs(v) > peak) peak = Math.abs(v)
    }
    frames.push(adb(Math.sqrt(s / win)))
  }
  const quietFrom = Math.round(0.6 / 0.05)
  const quietTo = Math.round(QUIET_SEC / 0.05)
  const silence = frames.slice(quietFrom, quietTo)
  const reading = frames.slice(quietTo)
  return {
    duration: samples.length / sampleRate,
    peakDb: adb(peak),
    silenceDb: silence.length ? median(silence) : NaN,
    readingDb: reading.length ? pct(reading, 0.9) : NaN,
  }
}

/** Plain-language hint for why "not enough speech" happened. */
export function failureHint(q: QuickStats): string {
  if (!Number.isFinite(q.peakDb) || q.peakDb < -90) return 'The take is silent. The selected input is not receiving audio: check the input with Change, or that Wave Link routes the mic to it.'
  if (q.readingDb < -55) return 'Your voice barely reached the input. Raise the Wave XLR gain or check that you picked the right input.'
  if (q.readingDb - q.silenceDb < 15) return 'The "silence" was almost as loud as your reading. Stay quiet until the countdown ends, and check for fans, music or Discord playing into this input.'
  return 'The level looks fine but too few loud frames were found. Read the whole text after the countdown and keep recording until the end.'
}
