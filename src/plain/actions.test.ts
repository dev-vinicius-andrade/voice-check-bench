import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import type { MicPattern } from '../types'
import { nextActions, rankActions, type ActionContext } from './actions'
import { mic, noisyAnalysis, voiceAnalysis } from './testFixtures'
import type { Action } from './types'

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({ mic: mic(), hasSuggestion: true, ...over })
const ids = (xs: Action[]) => xs.map((x) => x.id)

describe('nextActions', () => {
  it('has nothing to suggest for a clean take', () => {
    expect(nextActions(fakeAnalysis(), ctx())).toEqual([])
  })

  it('returns at most 3 actions, sorted by impact, never duplicated', () => {
    const a = noisyAnalysis({ snr: 5, clip: 4, hum: [{ hz: 60, db: 20 }], rel: [-18, -4, -1, 2, 0, -6, -17, -11, -17] })
    const xs = nextActions(a, ctx({ currentDist: '15 cm' }))
    expect(xs).toHaveLength(3)
    expect(new Set(ids(xs)).size).toBe(3)
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1].impact).toBeGreaterThanOrEqual(xs[i].impact)
  })

  it('puts free before paid on equal impact', () => {
    const xs = nextActions(noisyAnalysis(), ctx({ currentDist: '15 cm' }))
    // noise penalty: (30 - 10) × 1.5 + 5 = 35
    expect(ids(xs)).toEqual(['placement', 'noiseReduction', 'moveCloser'])
    expect(xs[0]).toMatchObject({ cost: 'free', impact: 35, how: 'placement' })
    expect(xs[1]).toMatchObject({ cost: 'minutes', impact: 35, how: 'settings' })
    expect(xs[2].text).toEqual({ key: 'plain.action.moveCloser', params: { cm: 8 } })
  })

  it('ranks a bigger level problem above a mild noise problem', () => {
    const xs = nextActions(fakeAnalysis({ snr: 22, noiseKind: 'broadband', clip: 9 }), ctx({ currentDist: '8 cm' }))
    expect(xs[0]).toMatchObject({ id: 'gainDown', impact: 15, how: 'gain', text: { key: 'plain.action.gainDown' } })
    expect(ids(xs)).toEqual(['gainDown', 'placement', 'noiseReduction'])
  })

  it('turns the gain up for a quiet voice', () => {
    expect(nextActions(fakeAnalysis({ speechMed: -31 }), ctx())).toEqual([
      { id: 'gainUp', text: { key: 'plain.action.gainUp' }, cost: 'free', impact: 10, how: 'gain' },
    ])
  })

  it('keys the placement tip by mic pattern', () => {
    const key = (pattern: MicPattern) => nextActions(noisyAnalysis(), ctx({ mic: mic({ pattern }) }))[0].text.key
    expect(key('cardioid')).toBe('plain.action.placement.cardioid')
    expect(key('supercardioid')).toBe('plain.action.placement.supercardioid')
    expect(key('omni')).toBe('plain.action.placement.other')
    expect(key('figure8')).toBe('plain.action.placement.other')
    expect(key('unknown')).toBe('plain.action.placement.other')
  })

  it('keys "speak straight into the mic" by address', () => {
    const muffled = voiceAnalysis(6, -9)
    const key = (address: 'end' | 'side' | 'unknown') => nextActions(muffled, ctx({ mic: mic({ address }) }))[0].text.key
    expect(key('end')).toBe('plain.action.speakInto.end')
    expect(key('side')).toBe('plain.action.speakInto.side')
    expect(key('unknown')).toBe('plain.action.speakInto.unknown')
  })

  it('offers the EQ settings only with a suggestion and a tone penalty ≥ 8, after the free tone fix', () => {
    const boomy = voiceAnalysis(1, 12)
    expect(ids(nextActions(boomy, ctx()))).toEqual(['backOff', 'eqSettings'])
    expect(ids(nextActions(boomy, ctx({ hasSuggestion: false })))).toEqual(['backOff'])
    expect(ids(nextActions(voiceAnalysis(1, 5), ctx()))).toEqual(['backOff'])
  })

  it('angles the mic for sharp S sounds', () => {
    expect(ids(nextActions(fakeAnalysis({ sibP95: -2 }), ctx()))).toEqual(['angleMic'])
  })

  it('adds the USB-port action only for hum ≥ 12 dB', () => {
    expect(ids(nextActions(fakeAnalysis({ hum: [{ hz: 50, db: 11.9 }] }), ctx()))).toEqual([])
    const xs = nextActions(fakeAnalysis({ hum: [{ hz: 50, db: 12 }] }), ctx())
    expect(xs).toEqual([{ id: 'usbPort', text: { key: 'plain.action.usbPort' }, cost: 'free', impact: 5 }])
  })

  it('suggests moving closer only when farther than a fist and not while the voice is boomy', () => {
    const has = (c: Partial<ActionContext>, a = noisyAnalysis({ tones: [] })) =>
      nextActions(a, ctx({ hasSuggestion: false, ...c })).some((x) => x.id === 'moveCloser')
    expect(has({ currentDist: '15 cm' })).toBe(true)
    expect(has({ currentDist: '8 cm' })).toBe(false)
    expect(has({ currentDist: '2 cm' })).toBe(false)
    expect(has({ currentDist: null, bestDist: '8 cm' })).toBe(false)
    expect(has({ currentDist: null, bestDist: '15 cm' })).toBe(true)
    expect(has({})).toBe(true)
    const boomyNoisy = voiceAnalysis(1, 9, { snr: 10, noiseKind: 'broadband' })
    expect(has({ currentDist: '15 cm' }, boomyNoisy)).toBe(false)
    expect(ids(nextActions(boomyNoisy, ctx({ currentDist: '15 cm', hasSuggestion: false })))).toContain('backOff')
  })

  it('skips the noise-reduction settings without a suggestion', () => {
    expect(ids(nextActions(noisyAnalysis(), ctx({ hasSuggestion: false, currentDist: '15 cm' })))).toEqual(['placement', 'moveCloser', 'fans'])
  })
})

describe('rankActions', () => {
  const act = (id: Action['id'], impact: number, cost: Action['cost'] = 'free'): Action => ({ id, text: { key: id }, cost, impact })
  it('drops duplicate ids, keeping the first', () => {
    const xs = rankActions([act('fans', 3), act('fans', 9), act('placement', 5)])
    expect(xs.map((x) => [x.id, x.impact])).toEqual([['placement', 5], ['fans', 3]])
  })
  it('orders by impact, then free before paid, then input order', () => {
    const xs = rankActions([act('eqSettings', 10, 'minutes'), act('angleMic', 10), act('backOff', 10), act('fans', 11)], 4)
    expect(ids(xs)).toEqual(['fans', 'angleMic', 'backOff', 'eqSettings'])
  })
})
