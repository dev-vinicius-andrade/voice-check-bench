import { describe, expect, it } from 'vitest'
import type { ValueChange } from './types'
import { advise, NR_STEP } from './advise'
import { eqKey } from './chain'
import { chain, comp, eq, gate, GUIDE_BANDS, held, noiseRemoval, tone } from './testFixtures'
import type { Advice } from './types'

const value = (a: Advice | undefined): ValueChange => {
  if (!a || a.kind !== 'value') throw new Error('expected a value change')
  return a
}
const summary = (list: Advice[]): string[] => list.map((a) => `${a.reason} ${a.slot}:${a.kind === 'value' ? `${a.key} ${a.from}→${a.to}` : a.on}`)

describe('advise: when to say anything', () => {
  it('nothing heard yet → no advice, even with a doubled gate and clipping', () => {
    const c = [gate({ dryDb: 0 }), comp(12)]
    expect(advise(held({ heardAtMs: null, heardAgoMs: null, clipFrames: 4, deadSilence: 0.5 }), c)).toEqual([])
  })

  it('speech heard before notBeforeMs → no advice; at or after it → advice', () => {
    const c = [gate({ dryDb: 0 })]
    expect(advise(held({ heardAtMs: 1000 }), c, undefined, { notBeforeMs: 1500 })).toEqual([])
    expect(advise(held({ heardAtMs: 1500 }), c, undefined, { notBeforeMs: 1500 })).toHaveLength(1)
  })

  it('good voice on the guide chain → no advice', () => {
    expect(advise(held(), chain())).toEqual([])
  })
})

describe('advise: doubled ReaGate', () => {
  it('Wet and Dry open → Dry to −20', () => {
    const a = advise(held(), [gate({ wetDb: 0, dryDb: 0 })])
    expect(summary(a)).toEqual(['gateDoubled 1:dryDb 0→-20'])
    expect(a[0].id).toBe('gateDoubled:1:dryDb')
    expect(a[0].titleMsg).toEqual({ key: 'desktop.advice.title.gateDoubled', params: { from: 0, to: -20 } })
    expect(a[0].changeMsg).toEqual({ key: 'desktop.advice.change.db', params: { plugin: 'ReaGate', field: 'Dry', from: 0, to: -20 } })
  })

  it('does not fire for a soft gate, a gate that is off, or a switched-off slot', () => {
    expect(advise(held(), [gate({ dryDb: -20 })])).toEqual([])
    expect(advise(held(), [gate({ dryDb: -10 })])).toEqual([])
    expect(advise(held(), [gate({ wetDb: -100, dryDb: 0 })])).toEqual([])
    expect(advise(held(), [gate({ dryDb: 0 }, false)])).toEqual([])
  })
})

describe('advise: too loud', () => {
  it('speech above the good range → Wet down until speech sits at −21', () => {
    const a = advise(held({ speechDb: -14 }), [comp(12)])
    expect(summary(a)).toEqual(['tooLoud 3:wetDb 12→5'])
    expect(a[0].titleMsg.params).toEqual({ db: 7, target: -21 })
    expect(a[0].changeMsg).toEqual({ key: 'desktop.advice.change.db', params: { plugin: 'ReaComp', field: 'Wet', from: 12, to: 5 } })
  })

  it('clipped → at least CLIP_MIN_DROP_DB (3) down, even with speech in range; peaks at −1 count as clipped', () => {
    expect(summary(advise(held({ speechDb: -20, clipFrames: 2 }), [comp(12)]))).toEqual(['tooLoud 3:wetDb 12→9'])
    expect(summary(advise(held({ speechDb: -20, peakDb: -1 }), [comp(12)]))).toEqual(['tooLoud 3:wetDb 12→9'])
  })

  it('never below 0 dB; nothing when Wet is already 0', () => {
    expect(summary(advise(held({ speechDb: -10 }), [comp(4)]))).toEqual(['tooLoud 3:wetDb 4→0'])
    expect(advise(held({ speechDb: -10 }), [comp(0)])).toEqual([])
  })

  it('does not fire inside the good range', () => {
    expect(advise(held({ speechDb: -16 }), [comp(12)])).toEqual([])
  })

  it('uses the last switched-on ReaComp (the last gain stage)', () => {
    expect(advise(held({ speechDb: -14 }), [comp(12, true, 3), comp(10, true, 5)])[0].slot).toBe(5)
    expect(advise(held({ speechDb: -14 }), [comp(12, true, 3), comp(10, false, 5)])[0].slot).toBe(3)
  })

  it("counts what the doubled gate's fix takes off (as refine)", () => {
    // 0/0 → 0/−20 lowers the open voice by 5.2 dB: −14 becomes −19.2, inside the range
    expect(summary(advise(held({ speechDb: -14 }), [gate({ dryDb: 0 }), comp(12)]))).toEqual(['gateDoubled 1:dryDb 0→-20'])
    // −10 becomes −15.2: Wet down ceil(5.8) = 6
    expect(summary(advise(held({ speechDb: -10 }), [gate({ dryDb: 0 }), comp(12)]))).toEqual(['gateDoubled 1:dryDb 0→-20', 'tooLoud 3:wetDb 12→6'])
  })
})

describe('advise: dead silence in pauses', () => {
  const dead = held({ deadSilence: 0.1 })

  it('Noise Removal on → strength down one step', () => {
    const a = advise(dead, chain())
    expect(summary(a)).toEqual([`deadSilence 0:strength 85→${85 - NR_STEP}`])
    expect(a[0].changeMsg).toEqual({ key: 'desktop.advice.change.strength', params: { plugin: 'Elgato Noise Removal', from: 85, to: 65 } })
    expect(summary(advise(dead, [noiseRemoval(10)]))).toEqual(['deadSilence 0:strength 10→0'])
  })

  it('Noise Removal at 0, off or absent → ReaGate Threshold −10 dB, not below −72', () => {
    expect(summary(advise(dead, [noiseRemoval(0), gate()]))).toEqual(['deadSilence 1:thresholdDb -50→-60'])
    expect(summary(advise(dead, [noiseRemoval(85, false), gate()]))).toEqual(['deadSilence 1:thresholdDb -50→-60'])
    expect(summary(advise(dead, [gate({ thresholdDb: -68 })]))).toEqual(['deadSilence 1:thresholdDb -68→-72'])
    expect(advise(dead, [gate({ thresholdDb: -72 })])).toEqual([])
  })

  it('a gate that passes everything (off, or Dry at 0 dB) is not lowered', () => {
    expect(advise(dead, [gate({ wetDb: -100, dryDb: 0 })])).toEqual([])
  })

  it('does not fire at or below 5 % dead silence', () => {
    expect(advise(held({ deadSilence: 0.05 }), chain())).toEqual([])
  })
})

describe('advise: too quiet', () => {
  it('speech below the good range → Wet up toward −21', () => {
    const a = advise(held({ speechDb: -30 }), [comp(6)])
    expect(summary(a)).toEqual(['tooQuiet 3:wetDb 6→15'])
    expect(a[0].titleMsg.params).toEqual({ db: 9, target: -21 })
  })

  it('capped at WET_CAP (18); nothing when Wet is already there', () => {
    expect(summary(advise(held({ speechDb: -35 }), [comp(14)]))).toEqual(['tooQuiet 3:wetDb 14→18'])
    expect(advise(held({ speechDb: -35 }), [comp(18)])).toEqual([])
  })

  it('does not fire inside the good range, or when it clipped', () => {
    expect(advise(held({ speechDb: -26 }), [comp(6)])).toEqual([])
    expect(advise(held({ speechDb: -30, clipFrames: 1 }), [comp(6)]).map((a) => a.reason)).toEqual(['tooLoud'])
  })
})

describe('advise: tone vs the goal (ReaEQ)', () => {
  it('harsh → 3.5 kHz band down 0.7 × the deviation, inside the guide range', () => {
    const a = advise(held({ tone: tone({ 6: 6 }) }), [eq()])
    expect(summary(a)).toEqual([`tone 2:${eqKey(4, 'gainDb')} 0→-4`])
    expect(a[0].titleMsg).toEqual({ key: 'desktop.advice.title.tone.high.presence', params: { db: 4 } })
    expect(a[0].changeMsg).toEqual({ key: 'desktop.advice.change.eq', params: { plugin: 'ReaEQ', type: 'Band', freq: 3500, from: 0, to: -4 } })
  })

  it('boomy → 150 Hz low shelf down; thin → up, capped at +2', () => {
    expect(summary(advise(held({ tone: tone({ 1: 5 }) }), [eq()]))).toEqual([`tone 2:${eqKey(1, 'gainDb')} 0→-3.5`])
    expect(summary(advise(held({ tone: tone({ 1: -5 }) }), [eq()]))).toEqual([`tone 2:${eqKey(1, 'gainDb')} 0→2`])
  })

  it('below 4 dB nothing, unless the person hears that issue (above 1.5 dB)', () => {
    expect(advise(held({ tone: tone({ 6: 3 }) }), [eq()])).toEqual([])
    const goal = { style: 'natural' as const, perceived: ['harsh' as const] }
    expect(summary(advise(held({ tone: tone({ 6: 3 }) }), [eq()], goal))).toEqual([`tone 2:${eqKey(4, 'gainDb')} 0→-2`])
    // hearing "harsh" says nothing about the bass
    expect(advise(held({ tone: tone({ 1: 3 }) }), [eq()], goal)).toEqual([])
  })

  it('harsh while clipping: level first, no presence cut', () => {
    expect(advise(held({ tone: tone({ 6: 6 }), clipFrames: 3 }), [eq(), comp(12)]).map((a) => a.reason)).toEqual(['tooLoud'])
  })

  it('only bands that exist and are on; a band moved a little still counts', () => {
    expect(advise(held({ tone: tone({ 6: 6 }) }), [eq(GUIDE_BANDS.slice(0, 3))])).toEqual([])
    expect(advise(held({ tone: tone({ 6: 6 }) }), [eq(GUIDE_BANDS, false)])).toEqual([])
    const off = GUIDE_BANDS.map((b) => (b.freqHz === 3500 ? { ...b, on: false } : b))
    expect(advise(held({ tone: tone({ 6: 6 }) }), [eq(off)])).toEqual([])
    const moved = GUIDE_BANDS.map((b) => (b.freqHz === 3500 ? { ...b, freqHz: 3000, gainDb: -1 } : b))
    expect(summary(advise(held({ tone: tone({ 6: 6 }) }), [eq(moved)]))).toEqual([`tone 2:${eqKey(4, 'gainDb')} -1→-4`])
  })

  it('never moves the wrong way when a band is already past the guide range', () => {
    const deep = GUIDE_BANDS.map((b) => (b.freqHz === 3500 ? { ...b, gainDb: -6 } : b))
    expect(advise(held({ tone: tone({ 6: 6 }) }), [eq(deep)])).toEqual([])
  })

  it('biggest deviation first', () => {
    const a = advise(held({ tone: tone({ 1: 4.5, 6: 7, 7: -5 }) }), [eq()])
    expect(a.map((x) => x.titleMsg.key.split('.').slice(-2).join('.'))).toEqual(['high.presence', 'low.sibilance', 'high.boom'])
  })
})

describe('advise: order and one change per value', () => {
  it('orders by importance: doubled gate, too loud, dead silence, too quiet / tone', () => {
    const c = [noiseRemoval(), gate({ dryDb: 0 }), eq(), comp(12)]
    const a = advise(held({ speechDb: -8, deadSilence: 0.2, tone: tone({ 1: 6 }) }), c)
    expect(a.map((x) => x.reason)).toEqual(['gateDoubled', 'tooLoud', 'deadSilence', 'tone'])
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length)
  })

  it('two tone bands landing on the same ReaEQ band → one change, the bigger deviation', () => {
    // a single Band at 335 Hz is within half an octave of both 250 Hz (warmth) and 450 Hz (mud)
    const one = [{ type: 'Band', on: true, freqHz: 335, gainDb: 0, bwOct: 1 }] as const
    const a = advise(held({ tone: tone({ 2: 5, 3: 6 }) }), [eq(one)])
    expect(a).toHaveLength(1)
    expect(a[0].titleMsg.key).toBe('desktop.advice.title.tone.high.mud')
    expect(value(a[0]).key).toBe(eqKey(1, 'gainDb'))
  })

  it('only advises on values the chain has', () => {
    const noWet = { ...comp(12), values: { thresholdDb: -30, ratio: 3 } }
    expect(advise(held({ speechDb: -10 }), [noWet])).toEqual([])
    const other = { index: 9, kind: 'other' as const, name: 'VoiceFocus', on: true, values: { wetDb: 12 } }
    expect(advise(held({ speechDb: -10, deadSilence: 0.3 }), [other])).toEqual([])
  })
})
