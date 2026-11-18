// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prng } from '../../audio/testSignals'
import { createTakeAnalyzer } from './take'
import { noiseOnly, noiseStretches, voiceNoiseOf, type Stretch } from './voiceNoise'

const SR = 48000
const BURST_HZ = 110
const TONE_HZ = 923
/** Lead burst: peak dBFS, from / to, seconds. */
const BURST_DB = -30
const BURST_AT = [1.0, 1.5] as const
/** Steady tone: peak dBFS, the whole take. */
const TONE_DB = -50
/** The voice: sines away from the burst and the tone, RMS of a syllable dBFS. */
const VOICE_HZ = [180, 360, 540, 720, 1500, 2200, 3100]
const VOICE_DB = -24

interface Built {
  x: Float32Array
  burst: Float32Array
  /** Syllables, samples [from, to). */
  words: Stretch[]
  /** The pauses between the speech segments, samples [from, to). */
  pauses: Stretch[]
}

/**
 * 3 s lead (white room noise −70 dBFS, a steady 923 Hz tone, a 110 Hz burst at 1.0–1.5 s), then `segments` stretches
 * of speech-like syllables (2.5 s each) with `pauseSec` pauses between them, 0.1 s of room at the end.
 */
function build(segments = 3, pauseSec = 1, withBurst = true, seed = 4): Built {
  const rnd = prng(seed)
  const segSec = 2.5
  const sec = 3 + segments * segSec + (segments - 1) * pauseSec + 0.1
  const n = Math.round(sec * SR)
  const x = new Float32Array(n)
  const noiseAmp = 10 ** (-70 / 20) * Math.sqrt(3)
  const tone = 10 ** (TONE_DB / 20)
  for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * noiseAmp + tone * Math.sin((2 * Math.PI * TONE_HZ * i) / SR + 0.3)

  const burst = new Float32Array(n)
  if (withBurst) {
    const a = 10 ** (BURST_DB / 20)
    const from = Math.round(BURST_AT[0] * SR)
    const len = Math.round((BURST_AT[1] - BURST_AT[0]) * SR)
    const fade = Math.round(0.01 * SR)
    for (let i = 0; i < len; i++) burst[from + i] = a * Math.sin((2 * Math.PI * BURST_HZ * i) / SR) * Math.min(1, i / fade, (len - i) / fade)
    for (let i = 0; i < n; i++) x[i] += burst[i]
  }

  const amp = (10 ** (VOICE_DB / 20) * Math.sqrt(2)) / Math.sqrt(VOICE_HZ.length)
  const phase = VOICE_HZ.map(() => rnd() * 2 * Math.PI)
  const fade = Math.round(0.02 * SR)
  const words: Stretch[] = []
  const pauses: Stretch[] = []
  let t = 3 * SR
  for (let s = 0; s < segments; s++) {
    const end = t + Math.round(segSec * SR)
    while (t < end) {
      const len = Math.min(Math.round((0.2 + rnd() * 0.06) * SR), end - t)
      for (let i = 0; i < len; i++) {
        let v = 0
        for (let j = 0; j < VOICE_HZ.length; j++) v += Math.sin((2 * Math.PI * VOICE_HZ[j] * (t + i)) / SR + phase[j])
        x[t + i] += amp * v * Math.min(1, i / fade, (len - i) / fade)
      }
      words.push({ from: t, to: t + len })
      t += len + Math.round((0.06 + rnd() * 0.03) * SR)
    }
    t = end
    if (s < segments - 1) {
      pauses.push({ from: t, to: t + Math.round(pauseSec * SR) })
      t += Math.round(pauseSec * SR)
    }
  }
  return { x, burst, words, pauses }
}

const nearestPoint = (freqs: Float32Array, hz: number): number => {
  let best = 0
  for (let i = 1; i < freqs.length; i++) if (Math.abs(Math.log(freqs[i] / hz)) < Math.abs(Math.log(freqs[best] / hz))) best = i
  return best
}

const overlaps = (a: Stretch, b: Stretch): boolean => a.from < b.to && b.from < a.to
const inside = (s: readonly Stretch[], from: number, to: number): boolean => s.some((r) => r.from <= from && r.to >= to)
const sumDb = (dbs: readonly number[]): number => 10 * Math.log10(dbs.reduce((s, d) => s + 10 ** (d / 10), 0))

describe('noiseStretches', () => {
  const t = build()
  const st = noiseStretches(t.x, SR)

  it('covers the whole lead and the pauses, not the words', () => {
    expect(st[0]).toEqual({ from: 0, to: expect.any(Number) })
    expect(st[0].to).toBeGreaterThanOrEqual(3 * SR)
    for (const p of t.pauses) expect(inside(st, p.from + Math.round(0.15 * SR), p.to - Math.round(0.15 * SR))).toBe(true)
    for (const w of t.words) for (const s of st) expect(overlaps(s, w)).toBe(false)
    expect(st).toHaveLength(3)
  })

  it('is ascending, disjoint, each at least 0.2 s', () => {
    for (let i = 0; i < st.length; i++) {
      expect(st[i].to - st[i].from).toBeGreaterThanOrEqual(0.2 * SR)
      if (i > 0) expect(st[i].from).toBeGreaterThan(st[i - 1].to)
    }
  })

  it('is empty for a take shorter than the lead or without speech', () => {
    expect(noiseStretches(t.x.subarray(0, 2 * SR), SR)).toEqual([])
    const room = build(1, 1, true).x.map((v, i) => (i < 3 * SR ? v : v * 0))
    expect(noiseStretches(room, SR)).toEqual([])
  })
})

describe('voiceNoiseOf', () => {
  const t = build()
  const st = noiseStretches(t.x, SR)
  const vn = voiceNoiseOf(t.x, t.x, st, SR)
  if (!vn) throw new Error('not measured')
  const pt = (hz: number): number => nearestPoint(vn.freqsHz, hz)

  it('shows the lead burst and the steady tone in the noise; the tone is taken out of the voice', () => {
    const plain = build(3, 1, false)
    const without = voiceNoiseOf(plain.x, plain.x, noiseStretches(plain.x, SR), SR)
    if (!without) throw new Error('not measured')
    expect(vn.noiseDb[pt(BURST_HZ)] - without.noiseDb[pt(BURST_HZ)]).toBeGreaterThan(20)
    expect(vn.noiseDb[pt(TONE_HZ)]).toBeGreaterThan(TONE_DB - 2)
    expect(vn.voiceDb[pt(TONE_HZ)]).toBeLessThan(vn.noiseDb[pt(TONE_HZ)] - 8)
    expect(vn.voiceDb[pt(540)]).toBeGreaterThan(vn.noiseDb[pt(540)] + 20)
  })

  it('reads a steady sine at the take analyzer level', () => {
    const sine = new Float32Array(t.x.length)
    const a = 10 ** (TONE_DB / 20)
    for (let i = 0; i < sine.length; i++) sine[i] = a * Math.sin((2 * Math.PI * TONE_HZ * i) / SR + 0.3)
    const curve = createTakeAnalyzer(sine, sine, SR).read().rawDb
    expect(Math.abs(vn.noiseDb[pt(TONE_HZ)] - curve[pt(TONE_HZ)])).toBeLessThan(0.5)
  })

  it('gives the levels and the three regions', () => {
    expect(vn.voiceLevelDb).toBeGreaterThan(VOICE_DB - 2)
    expect(vn.voiceLevelDb).toBeLessThan(VOICE_DB + 1)
    expect(vn.regions.map((r) => r.id)).toEqual(['low', 'mid', 'high'])
    // the burst's own power over the stretches
    let e = 0
    let c = 0
    for (const s of st) {
      for (let i = s.from; i < s.to; i++) e += t.burst[i] * t.burst[i]
      c += s.to - s.from
    }
    const [low, mid, high] = vn.regions
    expect(Math.abs(low.noiseDb - 10 * Math.log10(e / c))).toBeLessThan(1)
    expect(Math.abs(mid.noiseDb - (TONE_DB - 3))).toBeLessThan(1)
    expect(high.noiseDb).toBeLessThan(mid.noiseDb - 10)
    expect(Math.abs(sumDb(vn.regions.map((r) => r.noiseDb)) - vn.noiseLevelDb)).toBeLessThan(0.5)
    for (const r of vn.regions) expect(r.underVoiceDb).toBeCloseTo(vn.voiceLevelDb - r.noiseDb, 9)
  })

  it('a render with the lead silenced: much less noise, the same voice', () => {
    const render = t.x.slice()
    render.fill(0, 0, 3 * SR)
    const r = voiceNoiseOf(render, t.x, st, SR)
    if (!r) throw new Error('not measured')
    expect(r.noiseLevelDb).toBeLessThan(vn.noiseLevelDb - 10)
    expect(r.regions[0].noiseDb).toBeLessThan(vn.regions[0].noiseDb - 20)
    expect(Math.abs(r.voiceLevelDb - vn.voiceLevelDb)).toBeLessThan(0.01)
  })

  it('is null without stretches or when the take cannot be measured', () => {
    expect(voiceNoiseOf(t.x, t.x, [], SR)).toBeNull()
    const room = t.x.map((v, i) => (i < 3 * SR ? v : 0))
    expect(voiceNoiseOf(room, room, [{ from: 0, to: 3 * SR }], SR)).toBeNull()
  })

  it('a 25 s take: well under half a second', () => {
    const long = build(7, 0.65, true, 9).x
    expect(long.length / SR).toBeGreaterThan(24)
    const s = noiseStretches(long, SR)
    expect(s.length).toBeGreaterThan(1)
    const t0 = performance.now()
    const r = voiceNoiseOf(long, long, s, SR)
    const ms = performance.now() - t0
    expect(r).not.toBeNull()
    expect(ms).toBeLessThan(500)
  })
})

describe('noiseOnly', () => {
  it('joins the stretches with 10 ms fades at each joint', () => {
    const x = new Float32Array(10000).fill(1)
    const out = noiseOnly(x, [{ from: 100, to: 2100 }, { from: 5000, to: 7000 }], SR)
    const fade = 480
    expect(out).toHaveLength(4000)
    expect(out[0]).toBe(0)
    expect(out[fade / 2]).toBeCloseTo(0.5, 6)
    expect(out[fade]).toBe(1)
    expect(out[1000]).toBe(1)
    expect(out[1999]).toBe(0)
    expect(out[1999 - fade / 2]).toBeCloseTo(0.5, 6)
    expect(out[2000]).toBe(0)
    expect(out[3000]).toBe(1)
    expect(out[3999]).toBe(0)
  })

  it('is empty without stretches', () => {
    expect(noiseOnly(new Float32Array(1000), [], SR)).toHaveLength(0)
  })
})
