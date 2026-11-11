// Test-only: engine stream frames of a voice-like signal.
import { voiceLike } from '../live/liveTestSignals'
import type { AudioFrame } from './types'

const SR = 48000
const N = 4800

/** Stream frames of a voice-like signal: processed = raw × gain (already aligned, as the engine sends them). */
export function voiceFrames(sec: number, gain = 1, seed = 3, speechDb = -30): AudioFrame[] {
  const x = voiceLike({ sampleRate: SR, sec, seed, speechDb })
  const out: AudioFrame[] = []
  for (let k = 0; (k + 1) * N <= x.length; k++) {
    const raw = x.slice(k * N, (k + 1) * N)
    out.push({
      seq: k,
      sampleRate: SR,
      latencySamples: 480,
      settled: true,
      latencyChanged: false,
      rawRmsDb: -30,
      rawPeakDb: -10,
      processedRmsDb: -24,
      processedPeakDb: -6,
      counters: { blocks: k * 10, inputOverruns: 0, outputUnderruns: 0, monitorDropped: 0, streamDropped: 0, streamErrors: 0, processP50Us: 1, processP99Us: 2, processMaxUs: 3 },
      raw,
      processed: raw.map((v) => v * gain),
    })
  }
  return out
}


/** Frames of quiet room noise only (no speech), continuing after `fromSeq`. */
export function noiseFrames(sec: number, fromSeq: number, db = -70): AudioFrame[] {
  const amp = 10 ** (db / 20) * Math.sqrt(3)
  let s = 12345
  const rnd = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
  return voiceFrames(sec).map((f, k) => {
    const raw = new Float32Array(N).map(() => rnd() * amp)
    return { ...f, seq: fromSeq + k, raw, processed: raw.slice() }
  })
}
