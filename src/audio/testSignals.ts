// Deterministic synthetic takes and fixtures for unit tests only.
import type { Analysis } from '../types'

/** mulberry32 seeded PRNG, uniform in [0, 1). */
export function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 3 s of white noise at ~noiseDb dBFS RMS, then speechSec seconds of a speech-like signal
 * (sines 150–3000 Hz, amplitude-modulated at 4 Hz, ~speechDb dBFS) plus the same noise.
 */
export function syntheticTake({
  sampleRate = 48000,
  quietSec = 3,
  speechSec = 12,
  noiseDb = -80,
  speechDb = -25,
  seed = 1234,
}: Partial<{ sampleRate: number; quietSec: number; speechSec: number; noiseDb: number; speechDb: number; seed: number }> = {}): Float32Array {
  const rnd = prng(seed)
  const n = Math.round((quietSec + speechSec) * sampleRate)
  const q = Math.round(quietSec * sampleRate)
  const x = new Float32Array(n)
  // uniform [-1, 1) has RMS 1/sqrt(3)
  const noiseAmp = 10 ** (noiseDb / 20) * Math.sqrt(3)
  const freqs = [150, 300, 600, 1200, 2400, 3000]
  // sum of k unit sines has RMS sqrt(k/2); envelope median is ~0.6
  const sineAmp = 10 ** (speechDb / 20) / Math.sqrt(freqs.length / 2) / 0.6
  for (let i = 0; i < n; i++) {
    let v = (rnd() * 2 - 1) * noiseAmp
    if (i >= q) {
      const t = (i - q) / sampleRate
      const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)
      let s = 0
      for (const f of freqs) s += Math.sin(2 * Math.PI * f * t)
      v += s * sineAmp * env
    }
    x[i] = v
  }
  return x
}

/** A plausible analysis, overridable per field. */
export function fakeAnalysis(over: Partial<Analysis> = {}): Analysis {
  return {
    sampleRate: 48000,
    duration: 15,
    peak: -6,
    clip: 0,
    noise: -80,
    noiseFromQuiet: true,
    quietBroken: false,
    speechMed: -22,
    speechP90: -18,
    speechMax: -10,
    snr: 58,
    spread: 5,
    rel: [-18, -4, -1, 2, 0, -6, -7, -11, -17],
    hum: [],
    sibMed: -20,
    sibP95: -12,
    ...over,
  }
}
