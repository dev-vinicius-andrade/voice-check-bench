// Test-only: deterministic speech-like takes with a chosen spectrum, level, loudness swings and room noise.
import { BANDS } from '../../audio/reference'
import { prng } from '../../audio/testSignals'

export interface TestTakeOptions {
  sampleRate: number
  /** Room noise only, then speech, seconds. */
  quietSec: number
  speechSec: number
  seed: number
  /** RMS of a full syllable, dBFS. */
  speechDb: number
  /** White room noise under everything, dBFS RMS. */
  noiseDb: number
  /** Per BANDS entry: dB away from the reference curve (0 = the natural target). */
  tone: readonly number[]
  /** Loudness of each phrase in turn, dB (cycled): [0, -10] makes every other phrase 10 dB quieter. */
  phraseDb: readonly number[]
}

/** Sines per band, log-spaced inside it. */
const SINES = 5

/**
 * QUIET_SEC of room noise, then phrases of syllables (20 ms fades) separated by pauses. The "voice" is a fixed sum of
 * sines, SINES per band, whose band powers follow the reference curve plus `tone`, so analyze() reads `rel` =
 * reference + tone.
 */
export function testTake(opts: Partial<TestTakeOptions> = {}): Float32Array {
  const { sampleRate: sr = 48000, quietSec = 3, speechSec = 10, seed = 11, speechDb = -24, noiseDb = -75, tone = [], phraseDb = [0] } = opts
  const rnd = prng(seed)
  const n = Math.round((quietSec + speechSec) * sr)
  const start = Math.round(quietSec * sr)

  // the voice: unit-RMS sum of sines (two-multiply recursive oscillators)
  const voice = new Float64Array(n - start)
  let power = 0
  BANDS.forEach((b, bi) => {
    const p = 10 ** ((b.ref + (tone[bi] ?? 0)) / 10) / SINES
    power += p * SINES
    for (let k = 0; k < SINES; k++) {
      const hz = b.lo * (b.hi / b.lo) ** ((k + 0.25 + 0.5 * rnd()) / SINES)
      const w = (2 * Math.PI * hz) / sr
      const phase = rnd() * 2 * Math.PI
      const amp = Math.sqrt(2 * p)
      const c = 2 * Math.cos(w)
      let y1 = Math.sin(phase - w)
      let y2 = Math.sin(phase - 2 * w)
      for (let i = 0; i < voice.length; i++) {
        const y = c * y1 - y2
        y2 = y1
        y1 = y
        voice[i] += amp * y
      }
    }
  })
  const norm = 10 ** (speechDb / 20) / Math.sqrt(power)

  const x = new Float32Array(n)
  const noiseAmp = 10 ** (noiseDb / 20) * Math.sqrt(3)
  for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * noiseAmp

  const fade = Math.round(0.02 * sr)
  let t = start + Math.round(0.1 * sr)
  let phrase = 0
  while (t < n) {
    const g = norm * 10 ** (phraseDb[phrase % phraseDb.length] / 20)
    const phraseEnd = t + Math.round((0.9 + rnd() * 0.5) * sr)
    while (t < Math.min(phraseEnd, n)) {
      const len = Math.round((0.2 + rnd() * 0.1) * sr)
      for (let i = 0; i < len && t + i < n; i++) x[t + i] += voice[t + i - start] * g * Math.min(1, i / fade, (len - i) / fade)
      t += len + Math.round((0.06 + rnd() * 0.04) * sr)
    }
    t += Math.round((0.4 + rnd() * 0.2) * sr)
    phrase++
  }
  return x
}
