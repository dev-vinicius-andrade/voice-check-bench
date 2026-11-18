// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prng } from '../../audio/testSignals'
import { voiceLike } from '../../live/liveTestSignals'
import type { AudioFrame } from '../types'
import { createSpectrumAnalyzer } from './analyzer'
import { SPECTRUM_POINTS, type SpectrumAnalyzer } from './types'

const SR = 48000

/** Engine-like frames (100 ms) of aligned raw and processed signals. */
function frames(raw: Float32Array, processed: Float32Array = raw, sr = SR, seq0 = 0): AudioFrame[] {
  const n = Math.round(sr / 10)
  const out: AudioFrame[] = []
  for (let k = 0; (k + 1) * n <= raw.length; k++) {
    out.push({
      seq: seq0 + k,
      sampleRate: sr,
      latencySamples: 0,
      settled: true,
      latencyChanged: false,
      rawRmsDb: -30,
      rawPeakDb: -10,
      processedRmsDb: -30,
      processedPeakDb: -10,
      counters: { blocks: k, inputOverruns: 0, outputUnderruns: 0, monitorDropped: 0, streamDropped: 0, streamErrors: 0, processP50Us: 1, processP99Us: 2, processMaxUs: 3 },
      raw: raw.subarray(k * n, (k + 1) * n),
      processed: processed.subarray(k * n, (k + 1) * n),
    })
  }
  return out
}

/** A sine of peak amplitude 10^(db/20) (full-scale sine = 0 dBFS), added to x; `on` gates it per sample index. */
function addSine(x: Float32Array, hz: number, db: number, sr = SR, on: (i: number) => boolean = () => true): Float32Array {
  const a = 10 ** (db / 20)
  for (let i = 0; i < x.length; i++) if (on(i)) x[i] += a * Math.sin((2 * Math.PI * hz * i) / sr + 0.3)
  return x
}

/** White noise of RMS `db` dBFS, `share` of the time in bursts of 0.2–0.6 s (1 = always). */
function noise(sec: number, db: number, seed = 5, share = 1, sr = SR): Float32Array {
  const rnd = prng(seed)
  const x = new Float32Array(Math.round(sec * sr))
  const amp = 10 ** (db / 20) * Math.sqrt(3)
  let on = true
  for (let i = 0; i < x.length; ) {
    const len = Math.round((0.2 + rnd() * 0.4) * sr)
    for (let j = 0; j < len && i < x.length; j++, i++) x[i] = on ? (rnd() * 2 - 1) * amp : 0
    on = share >= 1 || rnd() < share
  }
  return x
}

const feed = (a: SpectrumAnalyzer, fs: AudioFrame[]): void => fs.forEach((f) => a.push(f))

const nearestPoint = (freqs: Float32Array, hz: number): number => {
  let best = 0
  for (let i = 1; i < freqs.length; i++) if (Math.abs(Math.log(freqs[i] / hz)) < Math.abs(Math.log(freqs[best] / hz))) best = i
  return best
}

/** Speech-like bursts over white noise, low-passed hard at 11 kHz (eight 2nd-order sections): nothing above 12 kHz. */
function bandLimited(sec: number, seed = 6): Float32Array {
  const rnd = prng(seed)
  let y = voiceLike({ sampleRate: SR, sec, seed, speechDb: -20, noiseDb: -Infinity, leadSec: 1 })
  for (let i = 0; i < y.length; i++) y[i] += (rnd() * 2 - 1) * 0.02
  const w = (2 * Math.PI * 11000) / SR
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const c = Math.cos(w)
  const a0 = 1 + alpha
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = (-2 * c) / a0, a2 = (1 - alpha) / a0
  for (let s = 0; s < 8; s++) {
    const o = new Float32Array(y.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = y[i]
      y2 = y1
      y1 = v
      o[i] = v
    }
    y = o
  }
  return y
}

/** The plot points from 13 kHz up stay at the plot's floor (−100 dB) and do not rise toward the 20 kHz edge. */
function flatTop(freqs: Float32Array, db: Float32Array): void {
  const from = freqs.findIndex((f) => f >= 13000)
  const top = Array.from(db.subarray(from))
  expect(top.length).toBeGreaterThan(10)
  expect(Math.max(...top)).toBeLessThan(-100)
  const last = top[top.length - 1]
  expect(last).toBeLessThanOrEqual(top[0])
  expect(last).toBeLessThanOrEqual(Math.min(...top.slice(0, -1)) + 1)
}

describe('createSpectrumAnalyzer: plot spectrum', () => {
  it('nothing above 12 kHz: the points up to 20 kHz stay at the floor, no rise at the edge', () => {
    const a = createSpectrumAnalyzer()
    const x = bandLimited(6)
    for (const [k, f] of frames(x).entries()) {
      a.push(f)
      if (k >= 5 && k % 7 === 0) {
        const s = a.read()
        flatTop(s.freqsHz, s.processedDb)
        flatTop(s.freqsHz, s.rawDb)
      }
    }
    const s = a.read()
    expect(s.processedDb[nearestPoint(s.freqsHz, 1000)]).toBeGreaterThan(-80)
  })

  it('starts at the floor with SPECTRUM_POINTS log-spaced points', () => {
    const s = createSpectrumAnalyzer().read()
    expect(s.freqsHz).toHaveLength(SPECTRUM_POINTS)
    expect(s.freqsHz[0]).toBeCloseTo(20, 3)
    expect(s.freqsHz[SPECTRUM_POINTS - 1]).toBeCloseTo(20000, 0)
    expect(Math.max(...s.rawDb)).toBe(-200)
    expect(s.tones).toEqual([])
  })

  it('reads a full-scale sine at about 0 dB at its point, far lower elsewhere', () => {
    for (const hz of [1000, 5000, 200]) {
      const a = createSpectrumAnalyzer()
      feed(a, frames(addSine(new Float32Array(SR), hz, 0)))
      const s = a.read()
      const i = nearestPoint(s.freqsHz, hz)
      expect(Math.abs(s.rawDb[i]), `${hz} Hz`).toBeLessThan(1.5)
      expect(Math.abs(s.processedDb[i])).toBeLessThan(1.5)
      expect(s.rawDb[nearestPoint(s.freqsHz, hz * 4)]).toBeLessThan(-60)
    }
  })

  it('a −47 dBFS sine reads about −47 dB', () => {
    const a = createSpectrumAnalyzer()
    feed(a, frames(addSine(new Float32Array(SR), 923, -47)))
    const s = a.read()
    expect(s.rawDb[nearestPoint(s.freqsHz, 923)]).toBeGreaterThan(-48.5)
    expect(s.rawDb[nearestPoint(s.freqsHz, 923)]).toBeLessThan(-45.5)
  })

  it('rises fast and falls slowly', () => {
    const a = createSpectrumAnalyzer()
    const x = addSine(new Float32Array(SR), 1000, -20)
    feed(a, frames(x))
    const i = nearestPoint(a.read().freqsHz, 1000)
    const silence = new Float32Array(SR / 10)
    a.push(frames(silence, silence, SR, 10)[0])
    const after100 = a.read().rawDb[i]
    // 100 ms after the sine stopped: down a little, not gone (600 ms release)
    expect(after100).toBeLessThan(-20)
    expect(after100).toBeGreaterThan(-80)
    // and up again within ~200 ms of it coming back
    const b = createSpectrumAnalyzer()
    feed(b, frames(noise(1, -90)))
    const quiet = b.read().rawDb[i]
    feed(b, frames(addSine(new Float32Array(SR / 5), 1000, -20), undefined, SR, 10))
    expect(quiet).toBeLessThan(-100)
    expect(b.read().rawDb[i]).toBeGreaterThan(-25)
  })

  it('keeps raw and processed apart', () => {
    const a = createSpectrumAnalyzer()
    const raw = addSine(new Float32Array(SR), 1000, -10)
    feed(a, frames(raw, raw.map((v) => v * 0.1)))
    const s = a.read()
    const i = nearestPoint(s.freqsHz, 1000)
    expect(s.rawDb[i] - s.processedDb[i]).toBeCloseTo(20, 0)
  })

  it('read() reuses the same arrays', () => {
    const a = createSpectrumAnalyzer()
    feed(a, frames(noise(0.5, -40)))
    const s1 = a.read()
    feed(a, frames(noise(0.5, -40, 9)))
    expect(a.read().rawDb).toBe(s1.rawDb)
  })
})

describe('createSpectrumAnalyzer: steady tones', () => {
  it('finds a −47 dBFS 923 Hz whistle under speech within 2 Hz', () => {
    const x = addSine(voiceLike({ sampleRate: SR, sec: 12, seed: 3, speechDb: -28, noiseDb: -70 }), 923, -47)
    const a = createSpectrumAnalyzer()
    feed(a, frames(x))
    const t = a.read().tones
    expect(t).toHaveLength(1)
    expect(Math.abs(t[0].freqHz - 923)).toBeLessThan(2)
    expect(t[0].overDb).toBeGreaterThan(12)
    expect(t[0].levelDb).toBeGreaterThan(-48.5)
    expect(t[0].levelDb).toBeLessThan(-45.5)
    expect(t[0]).toMatchObject({ inRaw: true, inProcessed: true })
  })

  it('finds it under noise bursts', () => {
    const x = addSine(noise(12, -30, 7, 0.6), 923, -47)
    const a = createSpectrumAnalyzer()
    feed(a, frames(x))
    const t = a.read().tones
    expect(t).toHaveLength(1)
    expect(Math.abs(t[0].freqHz - 923)).toBeLessThan(2)
  })

  it('needs about 4 s before reporting', () => {
    const x = addSine(noise(12, -70), 923, -47)
    const a = createSpectrumAnalyzer()
    const fs = frames(x)
    feed(a, fs.slice(0, 30))
    expect(a.read().tones).toEqual([])
    feed(a, fs.slice(30, 50))
    expect(a.read().tones).toHaveLength(1)
  })

  it('finds two tones 24 Hz apart (899 and 923 Hz), strongest first', () => {
    const x = addSine(addSine(voiceLike({ sampleRate: SR, sec: 12, seed: 4, speechDb: -28, noiseDb: -70 }), 923, -47), 899, -49)
    const a = createSpectrumAnalyzer()
    feed(a, frames(x))
    const t = a.read().tones
    expect(t.map((x) => Math.round(x.freqHz))).toHaveLength(2)
    expect(Math.abs(t[0].freqHz - 923)).toBeLessThan(2)
    expect(Math.abs(t[1].freqHz - 899)).toBeLessThan(2)
    expect(t[0].overDb).toBeGreaterThan(t[1].overDb)
  })

  it('reports nothing for speech alone (moving harmonics)', { timeout: 30000 }, () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const a = createSpectrumAnalyzer()
      feed(a, frames(voiceLike({ sampleRate: SR, sec: 15, seed, speechDb: -20, noiseDb: -70 })))
      expect(a.read().tones, `seed ${seed}`).toEqual([])
    }
  })

  it('ignores a tone too quiet to hear (near digital silence)', () => {
    const a = createSpectrumAnalyzer()
    feed(a, frames(addSine(noise(12, -130), 686, -105)))
    expect(a.read().tones).toEqual([])
  })

  it('reports nothing for noise alone', () => {
    for (const [db, share] of [[-60, 1], [-30, 0.5]] as const) {
      const a = createSpectrumAnalyzer()
      feed(a, frames(noise(15, db, 11, share)))
      expect(a.read().tones).toEqual([])
    }
  })

  it('a tone present half of the time is not steady', () => {
    const x = addSine(noise(15, -70), 923, -47, SR, (i) => Math.floor(i / SR) % 2 === 0)
    const a = createSpectrumAnalyzer()
    feed(a, frames(x))
    expect(a.read().tones).toEqual([])
  })

  it('says where the tone is: only in processed, or only in raw with its level as heard', () => {
    const room = noise(12, -70)
    const withTone = addSine(room.slice(), 1559, -50)
    const a = createSpectrumAnalyzer()
    feed(a, frames(room, withTone))
    expect(a.read().tones).toHaveLength(1)
    expect(a.read().tones[0]).toMatchObject({ inRaw: false, inProcessed: true })
    const b = createSpectrumAnalyzer()
    feed(b, frames(withTone, room))
    const t = b.read().tones
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ inRaw: true, inProcessed: false })
    expect(t[0].levelDb).toBeLessThan(-80)
  })

  it('forgets everything on reset() and when the alignment moved', () => {
    const fs = frames(addSine(noise(12, -70), 923, -47))
    const a = createSpectrumAnalyzer()
    feed(a, fs)
    expect(a.read().tones).toHaveLength(1)
    a.reset()
    expect(a.read().tones).toEqual([])
    expect(Math.max(...a.read().rawDb)).toBe(-200)
    feed(a, fs)
    expect(a.read().tones).toHaveLength(1)
    a.push({ ...fs[0], latencyChanged: true })
    expect(a.read().tones).toEqual([])
    feed(a, fs.slice(1, 30))
    expect(a.read().tones).toEqual([])
  })

  it('starts over on a sample-rate change and measures at the new rate', () => {
    const a = createSpectrumAnalyzer()
    feed(a, frames(addSine(noise(12, -70), 923, -47)))
    expect(a.read().tones).toHaveLength(1)
    const sr = 44100
    const fs = frames(addSine(noise(12, -70, 5, 1, sr), 1000, -47, sr), undefined, sr)
    a.push(fs[0])
    expect(a.read().tones).toEqual([])
    feed(a, fs.slice(1))
    const t = a.read().tones
    expect(t).toHaveLength(1)
    expect(Math.abs(t[0].freqHz - 1000)).toBeLessThan(2)
    const s = a.read()
    expect(Math.abs(s.rawDb[nearestPoint(s.freqsHz, 1000)] + 47)).toBeLessThan(1.5)
  })
})
