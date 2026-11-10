import { describe, expect, it } from 'vitest'
import type { Msg } from '../plain/types'
import { liveHints, MAX_HINTS, TONE_BANDS } from './hints'
import { LIVE_ENGINE_STRINGS } from './hintStrings'
import type { LiveError, LiveMetrics, LiveSide } from './types'

const side = (o: Partial<LiveSide> = {}): LiveSide => ({
  speechDb: -21,
  peakDb: -6,
  clipFrames: 0,
  pauseDb: -65,
  deadSilence: 0,
  tone: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ...o,
})
const metrics = (o: { fx?: Partial<LiveSide>; raw?: Partial<LiveSide> | null; talkSec?: number; sync?: number } = {}): LiveMetrics => ({
  talkSec: o.talkSec ?? 3,
  raw: o.raw === null ? null : side({ speechDb: -24, peakDb: -8, pauseDb: -55, ...o.raw }),
  fx: side(o.fx),
  lagMs: 30,
  sync: o.sync ?? 0.9,
  hints: [],
})
const keys = (m: LiveMetrics): string[] => liveHints(m).map((h) => h.key.replace('live.hint.', ''))
const tone = (entries: Record<number, number>): number[] => [0, 0, 0, 0, 0, 0, 0, 0, 0].map((v, i) => entries[i] ?? v)

describe('liveHints', () => {
  it('says nothing when everything is in range', () => {
    expect(liveHints(metrics())).toEqual([])
    expect(liveHints(metrics({ raw: null, sync: 0 }))).toEqual([])
  })

  it('only asks to keep talking with less than a second of talk', () => {
    expect(keys(metrics({ talkSec: 0.5, fx: { clipFrames: 4 }, sync: 0 }))).toEqual(['talkMore'])
  })

  it('says the raw mic is silent (wrong device) instead of the sync warning', () => {
    expect(keys(metrics({ raw: { peakDb: -80, speechDb: -95 }, sync: 0.1 }))[0]).toBe('rawSilent')
    expect(keys(metrics({ raw: { peakDb: -80, speechDb: -95 }, sync: 0.1 }))).not.toContain('noRawSync')
  })

  it('warns first when the two inputs do not line up', () => {
    expect(keys(metrics({ sync: 0.2, fx: { speechDb: -12 } }))).toEqual(['noRawSync', 'tooLoud'])
    expect(keys(metrics({ sync: 0.3 }))).toEqual([])
  })

  it('too loud: Wet down to the middle of the good range, at least 3 dB when it clipped', () => {
    expect(liveHints(metrics({ fx: { speechDb: -12 } }))).toEqual([{ key: 'live.hint.tooLoud', params: { db: 9 } }])
    expect(liveHints(metrics({ fx: { clipFrames: 2 } }))).toEqual([{ key: 'live.hint.tooLoud', params: { db: 3 } }])
    expect(liveHints(metrics({ fx: { peakDb: -0.5 } }))).toEqual([{ key: 'live.hint.tooLoud', params: { db: 3 } }])
    expect(liveHints(metrics({ fx: { speechDb: -15.5, clipFrames: 1 } }))).toEqual([{ key: 'live.hint.tooLoud', params: { db: 6 } }])
    expect(keys(metrics({ fx: { speechDb: -16 } }))).toEqual([])
  })

  it('too quiet: Wet up to the middle of the good range', () => {
    expect(liveHints(metrics({ raw: { speechDb: -33 }, fx: { speechDb: -30 } }))).toEqual([{ key: 'live.hint.tooQuiet', params: { db: 9 } }])
    expect(keys(metrics({ fx: { speechDb: -26 } }))).toEqual([])
  })

  it('dead silence above the chopped limit', () => {
    expect(keys(metrics({ fx: { deadSilence: 0.06, pauseDb: -100 } }))).toEqual(['deadSilence'])
    expect(keys(metrics({ fx: { deadSilence: 0.05 } }))).toEqual([])
  })

  it('noise not reduced: level-matched pauses barely below the raw mic', () => {
    expect(keys(metrics({ fx: { pauseDb: -54 } }))).toEqual(['noiseNotReduced'])
    // 10 dB of Wet on everything: the pauses are louder, but 12 dB lower relative to the voice
    expect(keys(metrics({ raw: { speechDb: -31, pauseDb: -60 }, fx: { speechDb: -21, pauseDb: -58 } }))).toEqual([])
    // a quiet room is not worth a hint
    expect(keys(metrics({ raw: { pauseDb: -75 }, fx: { pauseDb: -72 } }))).toEqual([])
    // no pause measured on either side: no noise hint
    expect(keys(metrics({ raw: { pauseDb: NaN }, fx: { pauseDb: -54 } }))).toEqual([])
  })

  it('still noisy: pauses on the output above -50 dBFS, unless the output is cut to dead silence', () => {
    expect(keys(metrics({ raw: null, fx: { pauseDb: -45 } }))).toEqual(['stillNoisy'])
    expect(keys(metrics({ raw: { pauseDb: -30 }, fx: { pauseDb: -45 } }))).toEqual(['stillNoisy'])
    expect(keys(metrics({ raw: null, fx: { pauseDb: -45, deadSilence: 0.2 } }))).toEqual(['deadSilence'])
    expect(keys(metrics({ raw: null, fx: { pauseDb: -50 } }))).toEqual([])
  })

  it('tone: ReaEQ hints for bands at least 4 dB off the goal, biggest first, 0.7 × deviation capped at 6 dB', () => {
    const h = liveHints(metrics({ fx: { tone: tone({ 1: -9, 2: 3.9, 4: 10, 6: 5, 7: -4 }) } }))
    expect(h).toEqual([
      { key: 'live.hint.toneLow.boom', params: { db: 6 } },
      { key: 'live.hint.toneHigh.presence', params: { db: 3.5 } },
      { key: 'live.hint.toneLow.sibilance', params: { db: 3 } },
    ])
    expect(keys(metrics({ fx: { tone: tone({ 3: 4.2 }) } }))).toEqual(['toneHigh.mud'])
    expect(keys(metrics({ fx: { tone: tone({ 2: -6 }) } }))).toEqual(['toneLow.warmth'])
    // the raw mic's tone does not matter, and an unmeasured tone gives no hint
    expect(keys(metrics({ raw: { tone: tone({ 1: 12 }) } }))).toEqual([])
    expect(keys(metrics({ fx: { tone: tone({ 6: NaN }) } }))).toEqual([])
  })

  it('keeps the most important hints only', () => {
    const h = keys(metrics({ sync: 0.1, fx: { speechDb: -10, deadSilence: 0.3, pauseDb: -40, tone: tone({ 1: 8, 6: -7 }) } }))
    expect(h).toHaveLength(MAX_HINTS)
    expect(h).toEqual(['noRawSync', 'tooLoud', 'deadSilence', 'noiseNotReduced'])
  })
})

describe('LIVE_ENGINE_STRINGS', () => {
  type Tree = { readonly [k: string]: string | Tree }
  const at = (tree: Tree, path: string): string | Tree | undefined =>
    path.split('.').reduce<string | Tree | undefined>((t, k) => (t && typeof t === 'object' ? t[k] : undefined), tree)
  const allHintKeys = (): Msg[] => [
    ...['talkMore', 'noRawSync', 'deadSilence', 'noiseNotReduced', 'stillNoisy'].map((k) => ({ key: k })),
    ...['tooLoud', 'tooQuiet'].map((k) => ({ key: k, params: { db: 1 } })),
    ...TONE_BANDS.flatMap((b) => ['toneHigh', 'toneLow'].map((d) => ({ key: `${d}.${b.key}`, params: { db: 1 } }))),
  ]

  it('has every hint and error in English and Portuguese, with the same params', () => {
    const errors: LiveError[] = ['unsupported', 'permission', 'rawUnavailable', 'fxUnavailable', 'sameDevice', 'other']
    for (const lang of ['en', 'pt-BR'] as const) {
      const s = LIVE_ENGINE_STRINGS[lang]
      for (const m of allHintKeys()) {
        const text = at(s.hint, m.key)
        expect(typeof text, `${lang} hint.${m.key}`).toBe('string')
        const params = [...String(text).matchAll(/\{\{(\w+)/g)].map((x) => x[1])
        expect(params, `${lang} hint.${m.key}`).toEqual(Object.keys(m.params ?? {}))
      }
      for (const e of errors) expect(typeof s.error[e]).toBe('string')
    }
  })

  it('every key produced by liveHints exists', () => {
    const samples = [
      metrics({ talkSec: 0 }),
      metrics({ sync: 0.1, fx: { speechDb: -10, deadSilence: 0.3, tone: tone({ 1: 8 }) } }),
      metrics({ fx: { speechDb: -40, pauseDb: -54 } }),
      metrics({ raw: null, fx: { pauseDb: -40, tone: tone({ 7: -8 }) } }),
    ]
    for (const m of samples)
      for (const h of liveHints(m)) {
        const k = h.key.replace('live.hint.', '')
        expect(typeof at(LIVE_ENGINE_STRINGS.en.hint, k)).toBe('string')
        expect(typeof at(LIVE_ENGINE_STRINGS['pt-BR'].hint, k)).toBe('string')
      }
  })
})
