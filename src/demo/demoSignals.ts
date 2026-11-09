// Deterministic synthetic voice-like takes for the in-app demo session. Pure, no React.
// Same idea as src/audio/testSignals.ts (test-only): 3 s of room noise, then an amplitude-modulated
// "voice" made of sines, plus steady tones over the whole take. Here each partial has its own level,
// so a take can sound boomy (more low energy) or thin.

/** mulberry32 seeded PRNG, uniform in [0, 1). */
function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Sine {
  hz: number
  /** Level relative to the other partials, dB. */
  db: number
}

export interface DemoSignal {
  sampleRate?: number
  quietSec?: number
  speechSec?: number
  /** Broadband room noise, dBFS RMS. */
  noiseDb: number
  /** Voice level, dBFS RMS (before the envelope). */
  speechDb: number
  seed: number
  voice: readonly Sine[]
  /** Steady tones (fan, server) over the whole take, dBFS RMS each. */
  tones: readonly Sine[]
}

/** One mono take: QUIET_SEC-style silence with room noise, then the voice over the same noise. */
export function demoSamples({ sampleRate = 48000, quietSec = 3, speechSec = 12, noiseDb, speechDb, seed, voice, tones }: DemoSignal): Float32Array {
  const rnd = prng(seed)
  const n = Math.round((quietSec + speechSec) * sampleRate)
  const q = Math.round(quietSec * sampleRate)
  const x = new Float32Array(n)
  // uniform [-1, 1) has RMS 1/sqrt(3)
  const noiseAmp = 10 ** (noiseDb / 20) * Math.sqrt(3)
  const amps = voice.map((p) => 10 ** (p.db / 20))
  // sum of sines with amplitudes a_k has RMS sqrt(sum a_k^2 / 2); envelope median is ~0.6
  const norm = 10 ** (speechDb / 20) / Math.sqrt(amps.reduce((s, a) => s + a * a, 0) / 2) / 0.6
  const w = (hz: number): number => (2 * Math.PI * hz) / sampleRate
  const toneAmps = tones.map((t) => 10 ** (t.db / 20) * Math.SQRT2)
  for (let i = 0; i < n; i++) {
    let v = (rnd() * 2 - 1) * noiseAmp
    for (let k = 0; k < tones.length; k++) v += toneAmps[k] * Math.sin(w(tones[k].hz) * i)
    if (i >= q) {
      const j = i - q
      const env = 0.6 + 0.4 * Math.sin(w(4) * j)
      let s = 0
      for (let k = 0; k < voice.length; k++) s += amps[k] * Math.sin(w(voice[k].hz) * j + k)
      v += s * norm * env
    }
    x[i] = v
  }
  return x
}
