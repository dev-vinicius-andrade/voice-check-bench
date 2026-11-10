// Deterministic voice-like signals for the live engine's unit tests only.
import { prng } from '../audio/testSignals'

export interface VoiceLikeOptions {
  sampleRate: number
  /** Length, seconds. */
  sec: number
  seed: number
  /** RMS of a syllable, dBFS. */
  speechDb: number
  /** White room noise under everything, dBFS RMS (-Infinity for none). */
  noiseDb: number
  /** Silence before the first phrase, seconds. */
  leadSec: number
  /** Pause between phrases, seconds (range). */
  pauseSec: readonly [number, number]
}

/**
 * Phrases of syllables (harmonic tones, f0 jittered per syllable, 1/k harmonics up to 5 kHz, 20 ms fades) separated by
 * pauses, over white noise. Talk ≈ 70 % of the time with the default pauses.
 */
export function voiceLike(opts: Partial<VoiceLikeOptions> = {}): Float32Array {
  const { sampleRate: sr = 48000, sec = 4, seed = 7, speechDb = -24, noiseDb = -60, leadSec = 0.3, pauseSec = [0.35, 0.6] } = opts
  const rnd = prng(seed)
  const n = Math.round(sec * sr)
  const x = new Float32Array(n)
  const noiseAmp = Number.isFinite(noiseDb) ? 10 ** (noiseDb / 20) * Math.sqrt(3) : 0
  for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * noiseAmp
  const target = 10 ** (speechDb / 20)
  const fade = Math.round(0.02 * sr)
  let t = Math.round(leadSec * sr)
  while (t < n) {
    const phraseEnd = t + Math.round((0.9 + rnd() * 0.7) * sr)
    while (t < Math.min(phraseEnd, n)) {
      const len = Math.round((0.18 + rnd() * 0.12) * sr)
      const f0 = 140 * (0.9 + rnd() * 0.25)
      const ks: number[] = []
      for (let k = 1; k * f0 < 5000; k++) ks.push(k)
      // sum of sines with amplitudes 1/k has RMS sqrt(Σ 1/k² / 2)
      const rms = Math.sqrt(ks.reduce((s, k) => s + 1 / (k * k), 0) / 2)
      const phase = ks.map(() => rnd() * 2 * Math.PI)
      for (let i = 0; i < len && t + i < n; i++) {
        const g = Math.min(1, i / fade, (len - i) / fade)
        let v = 0
        for (let j = 0; j < ks.length; j++) v += Math.sin((2 * Math.PI * ks[j] * f0 * i) / sr + phase[j]) / ks[j]
        x[t + i] += (v / rms) * target * g
      }
      t += len + Math.round((0.06 + rnd() * 0.06) * sr)
    }
    t += Math.round((pauseSec[0] + rnd() * (pauseSec[1] - pauseSec[0])) * sr)
  }
  return x
}

export interface FxOptions {
  sampleRate: number
  /** fx lags raw by this much, ms. */
  delayMs: number
  gainDb: number
  /** One-pole low-pass corner, Hz (0 = none). */
  lowpassHz: number
  /** 10 ms blocks whose RMS is below this (dBFS, after gain) become exact zeros (-Infinity = no gate). */
  gateDb: number
  /** White noise added after processing, dBFS RMS (-Infinity = none). */
  addNoiseDb: number
  seed: number
}

/**
 * Raw and fx windows of `len` samples that end at the same instant, from a source of len + delay samples:
 * raw = the newest len samples, fx = the source delayed by delayMs, gained, low-passed and gated.
 */
export function rawAndFx(source: Float32Array, len: number, opts: Partial<FxOptions> = {}): { raw: Float32Array; fx: Float32Array } {
  const { sampleRate: sr = 48000, delayMs = 30, gainDb = 0, lowpassHz = 0, gateDb = -Infinity, addNoiseDb = -Infinity, seed = 99 } = opts
  const d = Math.round((delayMs * sr) / 1000)
  if (source.length < len + d) throw new RangeError('source too short')
  const off = source.length - len
  const raw = source.slice(off)
  const fx = source.slice(off - d, off - d + len)
  const g = 10 ** (gainDb / 20)
  const a = lowpassHz > 0 ? 1 - Math.exp((-2 * Math.PI * lowpassHz) / sr) : 1
  let y = 0
  for (let i = 0; i < len; i++) {
    y += a * (fx[i] * g - y)
    fx[i] = y
  }
  if (Number.isFinite(gateDb)) {
    const w = Math.round(0.01 * sr)
    const thr = 10 ** (gateDb / 20)
    for (let s = 0; s < len; s += w) {
      let e = 0
      const end = Math.min(len, s + w)
      for (let i = s; i < end; i++) e += fx[i] * fx[i]
      if (Math.sqrt(e / (end - s)) < thr) fx.fill(0, s, end)
    }
  }
  if (Number.isFinite(addNoiseDb)) {
    const rnd = prng(seed)
    const amp = 10 ** (addNoiseDb / 20) * Math.sqrt(3)
    for (let i = 0; i < len; i++) fx[i] += (rnd() * 2 - 1) * amp
  }
  return { raw, fx }
}
