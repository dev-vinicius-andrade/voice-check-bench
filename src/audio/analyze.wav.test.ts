// @vitest-environment node
// Spot checks against real recordings (_test/*.wav, local and git-ignored). Each skips when its file is absent.
import { describe, expect, it } from 'vitest'
import { nextActions } from '../plain/actions'
import { compareProcessed } from '../plain/compare'
import { plainRatings } from '../plain/ratings'
import { clarityScore, penalties } from '../plain/score'
import plainEn from '../i18n/locales/en/plain.json'
import type { Msg } from '../plain/types'
import { DEFAULT_GOAL, isAnalysisError, type Analysis } from '../types'
import { analyze } from './analyze'
import { diagnose } from './diagnose'

interface NodeFs {
  existsSync(p: URL): boolean
  readFileSync(p: URL): Uint8Array
}
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as NodeFs
const wavUrl = new URL('../../_test/no-filters.wav', import.meta.url)
const present = fs.existsSync(wavUrl)
const noisyUrl = new URL('../../_test/control-2-cm-raw.wav', import.meta.url)
const noisyPresent = fs.existsSync(noisyUrl)
/** English text of a plain-language Msg, for the log line. */
const plainText = (m: Msg): string => {
  const s = m.key.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), plainEn)
  return typeof s === 'string' ? s.replace(/\{\{\s*(\w+)[^}]*\}\}/g, (_, k: string) => String(m.params?.[k] ?? '')) : m.key
}
const processedUrl = new URL('../../_test/processed-15-cm-record-mix.wav', import.meta.url)
const processedPresent = fs.existsSync(processedUrl)

/** Minimal RIFF/WAVE PCM decoder (16- or 32-bit int, or 32-bit float), channels averaged to mono. */
function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let fmt = 0, channels = 0, sampleRate = 0, bits = 0, dataOff = -1, dataLen = 0
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = tag(o)
    const len = v.getUint32(o + 4, true)
    if (id === 'fmt ') {
      fmt = v.getUint16(o + 8, true)
      channels = v.getUint16(o + 10, true)
      sampleRate = v.getUint32(o + 12, true)
      bits = v.getUint16(o + 22, true)
    } else if (id === 'data') {
      dataOff = o + 8
      dataLen = Math.min(len, bytes.length - dataOff)
      break
    }
    o += 8 + len + (len & 1)
  }
  if (dataOff < 0) throw new Error('no data chunk')
  const bps = bits / 8
  const frames = Math.floor(dataLen / (bps * channels))
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < channels; c++) {
      const o = dataOff + (i * channels + c) * bps
      if (fmt === 3 && bits === 32) s += v.getFloat32(o, true)
      else if (bits === 16) s += v.getInt16(o, true) / 32768
      else if (bits === 32) s += v.getInt32(o, true) / 2147483648
      else throw new Error(`unsupported WAV: format ${fmt}, ${bits} bit`)
    }
    out[i] = s / channels
  }
  return { samples: out, sampleRate }
}

describe.skipIf(!present)('analyze on _test/no-filters.wav', () => {
  it('is close to the prototype numbers', () => {
    const { samples, sampleRate } = decodeWav(fs.readFileSync(wavUrl))
    const r = analyze(samples, sampleRate)
    expect(isAnalysisError(r)).toBe(false)
    const a = r as Analysis
    expect(a.speechMed).toBeCloseTo(-49.6, 0)
    expect(Math.abs(a.noise - -93)).toBeLessThanOrEqual(1.5)
    const proto = [-12.8, 4.2, 8.6, 6.8, 0, 0.5, -1.6, -1.0, -14.3]
    a.rel.forEach((v, i) => expect(Math.abs(v - proto[i])).toBeLessThanOrEqual(0.5))
    // very quiet room, quantized to 16 bit: short zeros only, never digital silence
    expect([a.zeroRatio, a.gateSwitches]).toEqual([0, 0])
    expect(diagnose(a).some((c) => c.id === 'overprocessed')).toBe(false)
  })
})

describe.skipIf(!noisyPresent)('analyze on _test/control-2-cm-raw.wav (server + ceiling fan)', () => {
  it('reports a noisy, tonal or broadband room with fan/server tones', () => {
    const { samples, sampleRate } = decodeWav(fs.readFileSync(noisyUrl))
    const r = analyze(samples, sampleRate)
    expect(isAnalysisError(r)).toBe(false)
    const a = r as Analysis
    console.log('control-2-cm-raw', JSON.stringify({
      noise: +a.noise.toFixed(1),
      snr: +a.snr.toFixed(1),
      noiseKind: a.noiseKind,
      tones: a.tones,
      bandSnr: a.bandSnr.map((v) => +v.toFixed(1)),
    }))
    expect(a.noise).toBeGreaterThan(-45)
    expect(a.snr).toBeLessThan(20)
    // a real room: no digital silence, so no over-processing check
    expect([a.zeroRatio, a.gateSwitches]).toEqual([0, 0])
    expect(diagnose(a).some((c) => c.id === 'overprocessed')).toBe(false)
    expect(['tonal', 'broadband']).toContain(a.noiseKind)
    expect(a.bandSnr).toHaveLength(9)
    expect(a.tones.some((t) => Math.abs(t.hz - 780) <= 780 * 0.05 || Math.abs(t.hz - 1560) <= 1560 * 0.05)).toBe(true)
  })

  it('scores against each voice goal (natural = no goal)', () => {
    const { samples, sampleRate } = decodeWav(fs.readFileSync(noisyUrl))
    const a = analyze(samples, sampleRate) as Analysis
    expect(clarityScore(a, { goal: DEFAULT_GOAL })).toEqual(clarityScore(a))
    const rows = (['natural', 'warm', 'clear', 'bright'] as const).map((style) => {
      const goal = { style, perceived: [] }
      const voice = plainRatings(a, { goal })[2]
      return { style, score: clarityScore(a, { goal }).score, voice: plainText(voice.label), tone: +penalties(a, { goal }).tone.toFixed(1) }
    })
    console.log('control-2-cm-raw by goal', JSON.stringify(rows))
  })
})

describe.skipIf(!processedPresent)('analyze on _test/processed-15-cm-record-mix.wav (ReaFIR far too strong)', () => {
  const load = (url: URL): Analysis => {
    const { samples, sampleRate } = decodeWav(fs.readFileSync(url))
    const r = analyze(samples, sampleRate)
    expect(isAnalysisError(r)).toBe(false)
    return r as Analysis
  }

  it('sees the digital silence and the gate flipping', () => {
    const a = load(processedUrl)
    expect(a.noise).toBeGreaterThanOrEqual(-100)
    expect(Number.isFinite(a.snr)).toBe(true)
    expect(a.zeroRatio).toBeGreaterThan(0.3)
    // 17 cut-outs of 20 ms or more in 19.5 s (zero-run starts per 10 s)
    expect(a.gateSwitches).toBeGreaterThan(6)
    expect(diagnose(a).find((c) => c.id === 'overprocessed')?.status).toBe('bad')
  })

  it.skipIf(!noisyPresent)('against the raw control: every regression, a lower score, the over-processing headline', () => {
    const fx = load(processedUrl)
    const raw = load(noisyUrl)
    const cmp = compareProcessed(raw, fx)
    expect(cmp.regressions).toEqual(expect.arrayContaining(['quieter', 'thin', 'harsh', 'chopped']))
    const before = clarityScore(raw)
    const after = clarityScore(fx, { raw })
    expect(after.score).toBeLessThan(before.score)
    expect(after.main).toBe('overprocessed')
    expect(after.headline.key).toBe('plain.score.overprocessed')
    const ratings = plainRatings(fx, { raw })
    expect(ratings[0].label.key).toBe('plain.rating.noise.label.cutToSilence')
    const actions = nextActions(fx, { mic: { model: 'Fifine K688', kind: 'dynamic', pattern: 'cardioid', address: 'end' }, hasSuggestion: true, raw })
    expect(actions[0].id).toBe('noiseRemovalDown')
    expect(actions.map((x) => x.id)).toContain('compWet')
    console.log('processed-15-cm-record-mix vs control-2-cm-raw', JSON.stringify({
      zeroRatio: +fx.zeroRatio.toFixed(3),
      gateSwitches: +fx.gateSwitches.toFixed(1),
      noise: +fx.noise.toFixed(1),
      snr: +fx.snr.toFixed(1),
      cmp: { regressions: cmp.regressions, levelDrop: +cmp.levelDrop.toFixed(1) },
      before: before.score,
      after: after.score,
      penalties: Object.fromEntries(Object.entries(after.penalties).map(([k, v]) => [k, +v.toFixed(1)])),
      headline: plainText(after.headline),
      explain: plainText(after.explain),
      ratings: ratings.map((r) => `${r.id}: ${plainText(r.label)} (${r.status}) - ${plainText(r.explain)}`),
      actions: actions.map((x) => `${plainText(x.text)} [${x.how ?? '-'}]`),
    }, null, 1))
  })
})
