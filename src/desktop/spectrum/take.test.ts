// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prng } from '../../audio/testSignals'
import { voiceLike } from '../../live/liveTestSignals'
import { createSpectrumAnalyzer } from './analyzer'
import { FLOOR_DB } from './framer'
import { createTakeAnalyzer } from './take'
import { SPECTRUM_POINTS } from './types'

const SR = 48000

/** A sine of peak amplitude 10^(db/20) added to x. */
function addSine(x: Float32Array, hz: number, db: number): Float32Array {
  const a = 10 ** (db / 20)
  for (let i = 0; i < x.length; i++) x[i] += a * Math.sin((2 * Math.PI * hz * i) / SR + 0.3)
  return x
}

/** White noise of RMS `db` dBFS. */
function noise(sec: number, db: number, seed = 5): Float32Array {
  const rnd = prng(seed)
  const x = new Float32Array(Math.round(sec * SR))
  const amp = 10 ** (db / 20) * Math.sqrt(3)
  for (let i = 0; i < x.length; i++) x[i] = (rnd() * 2 - 1) * amp
  return x
}

/** A take as recorded: 3 s of room noise, then speech-like bursts, `sec` long. */
const take = (sec: number, seed = 3): Float32Array => voiceLike({ sampleRate: SR, sec, seed, speechDb: -28, noiseDb: -70, leadSec: 3 })

/** A narrow notch (RBJ, Q 30) at `hz`, applied twice: about −40 dB at the centre. */
function notch(x: Float32Array, hz: number): Float32Array {
  const y = x.slice()
  const w = (2 * Math.PI * hz) / SR
  const alpha = Math.sin(w) / (2 * 30)
  const a0 = 1 + alpha
  const b0 = 1 / a0, b1 = (-2 * Math.cos(w)) / a0, b2 = 1 / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0
  for (let pass = 0; pass < 2; pass++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < y.length; i++) {
      const x0 = y[i]
      const out = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x0
      y2 = y1
      y1 = out
      y[i] = out
    }
  }
  return y
}

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

describe('createTakeAnalyzer', () => {
  it('nothing above 12 kHz: the points up to 20 kHz stay at the floor, no rise at the edge (average and positions)', () => {
    const x = bandLimited(8)
    const a = createTakeAnalyzer(x, x, SR)
    const s = a.read()
    // there is something below: the band-limited speech itself
    expect(s.processedDb[nearestPoint(s.freqsHz, 1000)]).toBeGreaterThan(-60)
    flatTop(s.freqsHz, s.processedDb)
    flatTop(s.freqsHz, s.rawDb)
    for (const sec of [0.1, 1.5, 3, 4.2, 6, 7.99, 99]) {
      a.seek(sec)
      flatTop(s.freqsHz, a.read().processedDb)
      flatTop(s.freqsHz, a.read().rawDb)
    }
  })

  it('reports a steady 923 Hz whistle of the whole take, in raw and processed', () => {
    const x = addSine(take(15), 923, -47)
    const s = createTakeAnalyzer(x, x, SR).read()
    expect(s.tones).toHaveLength(1)
    expect(Math.abs(s.tones[0].freqHz - 923)).toBeLessThan(2)
    expect(s.tones[0].overDb).toBeGreaterThan(12)
    expect(s.tones[0]).toMatchObject({ inRaw: true, inProcessed: true })
    expect(s.tones[0].levelDb).toBeGreaterThan(-48.5)
    expect(s.tones[0].levelDb).toBeLessThan(-45.5)
  })

  it('gives the live plot curves: SPECTRUM_POINTS on the same scale, a full-scale sine near 0 dB', () => {
    const x = addSine(new Float32Array(2 * SR), 1000, 0)
    const s = createTakeAnalyzer(x, x, SR).read()
    const live = createSpectrumAnalyzer().read()
    expect(s.freqsHz).toEqual(live.freqsHz)
    expect(s.rawDb).toHaveLength(SPECTRUM_POINTS)
    expect(s.processedDb).toHaveLength(SPECTRUM_POINTS)
    const i = nearestPoint(s.freqsHz, 1000)
    expect(Math.abs(s.rawDb[i])).toBeLessThan(1.5)
    expect(s.rawDb[nearestPoint(s.freqsHz, 100)]).toBeLessThan(-60)
  })

  it('seek: the spectrum around the position; null: the whole-take average again', () => {
    // 4 s of a 300 Hz sine, then 4 s of a 3 kHz one
    const x = new Float32Array(8 * SR)
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * (i < 4 * SR ? 300 : 3000) * i) / SR)
    const a = createTakeAnalyzer(x, x, SR)
    const [lo, hi] = [nearestPoint(a.read().freqsHz, 300), nearestPoint(a.read().freqsHz, 3000)]
    const avg = a.read().rawDb.slice()
    expect(Math.abs(avg[lo] - avg[hi])).toBeLessThan(1.5)
    a.seek(2)
    const early = a.read().rawDb.slice()
    expect(early[lo] - early[hi]).toBeGreaterThan(30)
    a.seek(7)
    const late = a.read().rawDb.slice()
    expect(late[hi] - late[lo]).toBeGreaterThan(30)
    // just past the switch the old tone is still fading (smoothed like the live plot)
    a.seek(4.3)
    const fading = a.read().rawDb
    expect(fading[lo]).toBeGreaterThan(late[lo] + 10)
    a.seek(null)
    expect(Array.from(a.read().rawDb)).toEqual(Array.from(avg))
    // positions outside the take stay inside it
    a.seek(-1)
    const neg = Array.from(a.read().rawDb)
    a.seek(0)
    expect(neg).toEqual(Array.from(a.read().rawDb))
    expect(neg[lo]).toBeGreaterThan(-10)
    a.seek(99)
    expect(a.read().rawDb[hi]).toBeGreaterThan(-10)
  })

  it('a notch-filtered render shows the tone lower as heard than in the mic alone', () => {
    const x = addSine(take(12, 4), 923, -40)
    const y = notch(x, 923)
    const s = createTakeAnalyzer(x, y, SR).read()
    const i = nearestPoint(s.freqsHz, 923)
    expect(s.rawDb[i] - s.processedDb[i]).toBeGreaterThan(15)
    expect(s.tones.some((t) => Math.abs(t.freqHz - 923) < 2 && t.inRaw)).toBe(true)
  })

  it('finds no tone in noise alone', () => {
    const x = noise(15, -60, 11)
    expect(createTakeAnalyzer(x, x, SR).read().tones).toEqual([])
  })

  it('push and reset do nothing', () => {
    const x = addSine(take(10), 923, -47)
    const a = createTakeAnalyzer(x, x, SR)
    const before = a.read()
    const raw = before.rawDb.slice()
    const tones = before.tones
    a.reset()
    a.push({
      seq: 0,
      sampleRate: SR,
      latencySamples: 0,
      settled: true,
      latencyChanged: true,
      rawRmsDb: 0,
      rawPeakDb: 0,
      processedRmsDb: 0,
      processedPeakDb: 0,
      counters: { blocks: 0, inputOverruns: 0, outputUnderruns: 0, monitorDropped: 0, streamDropped: 0, streamErrors: 0, processP50Us: 1, processP99Us: 2, processMaxUs: 3 },
      raw: new Float32Array(4800).fill(0.9),
      processed: new Float32Array(4800).fill(0.9),
    })
    const after = a.read()
    expect(Array.from(after.rawDb)).toEqual(Array.from(raw))
    expect(after.tones).toEqual(tones)
  })

  it('a take shorter than one frame reads the floor and no tones', () => {
    const x = new Float32Array(1000).fill(0.1)
    const s = createTakeAnalyzer(x, x, SR).read()
    expect(Math.max(...s.rawDb)).toBe(FLOOR_DB)
    expect(s.tones).toEqual([])
  })

  it('creates and reads a 25 s take quickly', () => {
    const x = addSine(take(25, 5), 923, -47)
    const y = notch(x, 923)
    const t0 = performance.now()
    const a = createTakeAnalyzer(x, y, SR)
    a.read()
    const ms = performance.now() - t0
    // well under a second on a desktop; loose here (tests run in parallel)
    expect(ms).toBeLessThan(3000)
  })
})
