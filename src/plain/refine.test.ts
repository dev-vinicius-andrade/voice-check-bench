// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import en from '../i18n/locales/en/plain.json'
import pt from '../i18n/locales/pt-BR/plain.json'
import { DEFAULT_GOAL, type Analysis, type AppliedSettings, type Take } from '../types'
import { baseDistance, changeApproachAdvice, evaluateProcessed, refine } from './refine'
import { clippedSession, realSession, sessionTake } from './testFixtures'
import type { Msg } from './types'

type Result = ReturnType<typeof refine>
const withAttempt = (a: AppliedSettings, attempt: number, over: Partial<AppliedSettings> = {}): AppliedSettings => ({ ...a, attempt, ...over })
const reasons = (r: Result) => r?.changes.map((c) => c.reason)
const keys = (r: Result) => r?.changes.map((c) => c.msg.key)
const band = (r: Result, type: string, freq: number) => r?.settings.eq.find((e) => e.type === type && e.freq === freq)
const withGate = (a: AppliedSettings, gate: Partial<AppliedSettings['settings']['gate']>, over: Partial<AppliedSettings> = {}): AppliedSettings => ({
  ...a, ...over, settings: { ...a.settings, gate: { ...a.settings.gate, ...gate } },
})

describe('evaluateProcessed', () => {
  it('real session: the processed take did not improve (score 0, every regression)', () => {
    const { c15, fx, applied } = realSession()
    const ev = evaluateProcessed(c15, fx, applied, DEFAULT_GOAL)
    expect(ev).toMatchObject({ improved: false, rawScore: 41, fxScore: 0, regressions: ['quieter', 'thin', 'harsh', 'chopped'], mismatch: null })
    expect(ev?.levelDrop).toBeCloseTo(11.6, 6)
  })

  it('a processed take at another distance than the applied settings is not used to judge them', () => {
    const { c15, fx, applied } = realSession()
    // compared with the raw control at 15 cm (where it was recorded), but the settings were made for 2 cm
    const ev = evaluateProcessed(c15, fx, { ...applied, dist: '2 cm' })
    expect(ev?.mismatch).toMatchObject({ expected: '2 cm', actual: '15 cm' })
    expect(ev?.improved).toBe(false)
  })

  it('the distance check follows the applied settings, not the raw reference', () => {
    const { c2, c15, fx, applied } = realSession()
    // c2 stands in as the raw reference: the settings were made for 15 cm, so the 15 cm take still judges them
    expect(evaluateProcessed(c2, fx, applied)?.mismatch).toBeNull()
    expect(baseDistance(c15, { dist: '2 cm' })).toBe('2 cm')
    // applied settings without a distance: the raw reference's
    expect(baseDistance(c15, { dist: '' })).toBe('15 cm')
  })

  it('improved: 5+ points over raw, no regressions, right distance', () => {
    const { c15, applied } = realSession()
    const good = sessionTake(5, 'fx', 'Processed · 15 cm · Record Mix', fakeAnalysis({ speechMed: -24, noise: -70, snr: 46, rel: [...(c15.analysis as Analysis).rel] }))
    const ev = evaluateProcessed(c15, good, applied)
    expect(ev?.regressions).toEqual([])
    expect(ev!.fxScore).toBeGreaterThanOrEqual(ev!.rawScore + 5)
    expect(ev?.improved).toBe(true)
    expect(refine(c15, good, applied)?.changes).toEqual([])
  })

  it('null when a take has no analysis', () => {
    const { c15, fx, applied } = realSession()
    const bad: Take = { ...fx, analysis: { error: 'x' } }
    expect(evaluateProcessed(c15, bad, applied)).toBeNull()
    expect(refine(bad, fx, applied)).toBeNull()
  })
})

describe('refine on the real session', () => {
  it('wrong distance first: record again at 2 cm, nothing else changes', () => {
    const { c15, fx, applied } = realSession()
    const r = refine(c15, fx, { ...applied, dist: '2 cm' })
    expect(r).toEqual({
      settings: applied.settings,
      changes: [{ reason: 'wrongDistance', msg: { key: 'plain.refine.wrongDistance', params: { dist: '2 cm', actual: '15 cm' } } }],
      noiseRemoval: 'reafir',
      dist: '2 cm',
      changeApproach: false,
    })
    expect(r?.settings).not.toBe(applied.settings)
  })

  it('matching distance, attempt 1: ReaFIR halved, gate -10 dB, Wet +12, bass cuts toward 0, harsh band down', () => {
    const { c15, fx, applied } = realSession()
    const before = JSON.stringify(applied)
    const r = refine(c15, fx, applied)
    expect(reasons(r)).toEqual(['chopped', 'gateTooHigh', 'quieter', 'thin', 'thin', 'harsh'])
    expect(keys(r)).toEqual([
      'plain.refine.chopped.reafirHalf', 'plain.refine.gateTooHigh', 'plain.refine.quieter',
      'plain.refine.thin.boom', 'plain.refine.thin.warmth', 'plain.refine.harsh.presence',
    ])
    expect(r?.changes[1].msg.params).toEqual({ db: 10, to: -51 })
    expect(r?.changes[2].msg.params).toEqual({ drop: 12, db: 12, to: 14 })
    expect(r?.settings.gate).toMatchObject({ threshold: -51, dry: -10 })
    expect(r?.settings.comp.wet).toBe(14)
    // boom lost 27 dB vs raw: the -3.5 dB shelf goes to 0 (not past it); warmth lost 1 dB: -4.5 -> -3.5
    expect(band(r, 'Low Shelf', 150)?.gain).toBe(0)
    expect(band(r, 'Band', 250)?.gain).toBe(-3.5)
    // presence rose 16 dB: a 3.5 kHz band at -4 (the floor) goes in before the high shelf; the shelf is already at -4
    expect(r?.settings.eq.map((e) => e.freq)).toEqual([150, 250, 3500, 10000, 1617, 1559, 768])
    expect(band(r, 'Band', 3500)).toMatchObject({ gain: -4, bw: 1.4 })
    expect(band(r, 'High Shelf', 10000)?.gain).toBe(-4)
    expect(r).toMatchObject({ noiseRemoval: 'reafir', dist: '15 cm', changeApproach: false })
    // pure: applied is untouched
    expect(JSON.stringify(applied)).toBe(before)
  })

  it('attempt 2 still chopped: switch to AI noise removal and turn the gate off (Wet down, Dry 0)', () => {
    const { c15, fx, applied } = realSession()
    const r = refine(c15, fx, withAttempt(applied, 2))
    expect(keys(r)?.slice(0, 2)).toEqual(['plain.refine.chopped.toAi', 'plain.refine.chopped.gateOff'])
    expect(r?.noiseRemoval).toBe('ai-elgato')
    expect(r?.settings.gate).toMatchObject({ threshold: -41, wet: -100, dry: 0 })
  })

  it('after 3 attempts without improving: change approach, no more number tweaks', () => {
    const { c15, fx, applied } = realSession()
    const r = refine(c15, fx, withAttempt(applied, 3))
    expect(r).toMatchObject({ changes: [], changeApproach: true, noiseRemoval: 'ai-elgato', dist: '15 cm' })
    expect(r?.settings).toEqual(applied.settings)
    expect(refine(c15, fx, withAttempt(applied, 4, { noiseRemoval: 'ai-nvidia' }))?.noiseRemoval).toBe('ai-nvidia')
    expect(changeApproachAdvice().map((m) => m.key)).toEqual([
      'plain.refine.changeApproach.ai', 'plain.refine.changeApproach.placement', 'plain.refine.changeApproach.closer',
    ])
  })

  it('a wrong distance wins even after 3 attempts', () => {
    const { c15, fx, applied } = realSession()
    expect(reasons(refine(c15, fx, withAttempt(applied, 3, { dist: '2 cm' })))).toEqual(['wrongDistance'])
  })
})

describe('refine on the too-loud session (Wet at the cap, clipping, AI noise removal cutting the pauses)', () => {
  it('settings made for 2 cm, take recorded at 15 cm: a mismatch even though the raw reference is the 15 cm take', () => {
    const { c15, fx, applied } = clippedSession()
    const r = refine(c15, fx, { ...applied, dist: '2 cm' })
    expect(reasons(r)).toEqual(['wrongDistance'])
    expect(r?.changes[0].msg.params).toEqual({ dist: '2 cm', actual: '15 cm' })
    expect(r?.settings.comp.wet).toBe(18)
  })

  it('too loud with Wet already at 0: asks to lower the mic gain instead', () => {
    const { c15, fx, applied } = clippedSession()
    const r = refine(c15, fx, { ...applied, settings: { ...applied.settings, comp: { ...applied.settings.comp, wet: 0 } } })
    expect(keys(r)).toContain('plain.refine.tooLoudGain')
    expect(r?.settings.comp.wet).toBe(0)
  })

  it('at the right distance: the doubled gate comes down first, then Wet only by what is left; the AI remover goes down', () => {
    const { c15, fx, applied } = clippedSession()
    const ev = evaluateProcessed(c15, fx, applied)
    expect(ev?.regressions).toEqual(['tooLoud', 'harsh', 'chopped'])
    expect(ev?.improved).toBe(false)
    const r = refine(c15, fx, applied)
    expect(keys(r)).toEqual(['plain.refine.chopped.aiLower', 'plain.refine.gateDoubled', 'plain.refine.tooLoud', 'plain.refine.harshFromClipping'])
    // ReaGate Wet 0 + Dry 0 adds the voice twice (+6.0 dB); Dry -20 leaves +0.8 dB: 5.2 dB less
    expect(r?.changes[1].msg.params).toEqual({ from: 0, to: -20 })
    expect(r?.settings.gate).toEqual({ ...applied.settings.gate, dry: -20 })
    // speech -13.9 - 5.2 = -19.1 -> target -21: ceil(1.9) = 2 dB down, 18 -> 16 (the clip minimum is covered by the gate)
    expect(r?.changes[2].msg.params).toEqual({ db: 2, to: 16 })
    expect(r?.settings.comp.wet).toBe(16)
    // no threshold change (Dry 0 never cut the voice); the EQ is not touched (the harshness is distortion)
    expect(r?.settings.eq).toEqual(applied.settings.eq)
    expect(r?.noiseRemoval).toBe('ai-elgato')
  })

  it('a clipped peak alone lowers Wet at least 3 dB, never below 0', () => {
    const { c15, fx, applied: doubled } = clippedSession()
    const applied = withGate(doubled, { dry: -20 })
    const raw = c15.analysis as Analysis
    const peaky = sessionTake(11, 'fx', fx.name, fakeAnalysis({ ...raw, speechMed: -20, peak: -0.5, snr: raw.snr + 10, zeroRatio: 0, gateSwitches: 0 }))
    const r = refine(c15, peaky, applied)
    expect(keys(r)).toEqual(['plain.refine.tooLoud'])
    expect(r?.settings.comp.wet).toBe(15)
    const low = { ...applied, settings: { ...applied.settings, comp: { ...applied.settings.comp, wet: 2 } } }
    expect(refine(c15, fx, low)?.settings.comp.wet).toBe(0)
  })

  it('too loud replaces quieter, even when the speech level dropped', () => {
    const { c15, fx, applied: doubled } = clippedSession()
    const applied = withGate(doubled, { dry: -20 })
    const raw = c15.analysis as Analysis
    const dropped = sessionTake(12, 'fx', fx.name, fakeAnalysis({ ...raw, speechMed: raw.speechMed - 10, peak: 0, snr: raw.snr + 10 }))
    const ev = evaluateProcessed(c15, dropped, applied)
    expect(ev?.regressions).toContain('tooLoud')
    expect(ev?.regressions).not.toContain('quieter')
    expect(reasons(refine(c15, dropped, applied))).toEqual(['tooLoud'])
  })

  it('chopped with no noise removal and the gate off: another effect is cutting the sound', () => {
    const { c15, applied } = clippedSession()
    const raw = c15.analysis as Analysis
    const fx = sessionTake(13, 'fx', 'Processed · 15 cm · Record Mix', fakeAnalysis({ ...raw, zeroRatio: 0.2, snr: raw.snr + 10 }))
    const off = withGate(applied, { wet: -100, dry: 0 }, { noiseRemoval: 'none' })
    const r = refine(c15, fx, off)
    expect(keys(r)).toEqual(['plain.refine.chopped.other'])
    expect(r?.settings.gate).toEqual(off.settings.gate)
  })
})

describe('refine rules', () => {
  const { c15, applied } = realSession()
  const raw = c15.analysis as Analysis
  const fxOf = (over: Partial<Analysis>): Take =>
    sessionTake(9, 'fx', 'Processed · 15 cm · Record Mix', fakeAnalysis({ ...raw, zeroRatio: 0, gateSwitches: 0, ...over }))

  it('chopped by digital silence alone (zeroRatio > 0.05) lowers the gate; it stops at -72, then the gate goes off', () => {
    expect(reasons(refine(c15, fxOf({ zeroRatio: 0.06, snr: raw.snr + 10 }), applied))).toEqual(['chopped', 'gateTooHigh'])
    expect(refine(c15, fxOf({ zeroRatio: 0.06 }), withGate(applied, { threshold: -66 }))?.settings.gate.threshold).toBe(-72)
    const r = refine(c15, fxOf({ zeroRatio: 0.06 }), withGate(applied, { threshold: -72 }, { noiseRemoval: 'none' }))
    expect(keys(r)).toEqual(['plain.refine.chopped.gateOff'])
    expect(r?.settings.gate).toMatchObject({ threshold: -72, wet: -100, dry: 0 })
  })

  it('a doubled gate (Wet and Dry both open) goes back to Dry -20 even when nothing else is wrong; -10 is not doubled', () => {
    // not improved (as in the quieter rule below), nothing else to change
    const fx = fxOf({ speechMed: raw.speechMed - 3.9, snr: raw.snr + 3 })
    const r = refine(c15, fx, withGate(applied, { dry: -3 }))
    expect(keys(r)).toEqual(['plain.refine.gateDoubled'])
    expect(r?.changes[0].msg.params).toEqual({ from: -3, to: -20 })
    expect(r?.settings.gate.dry).toBe(-20)
    expect(refine(c15, fx, applied)?.changes.some((c) => c.reason === 'gateDoubled')).toBe(false)
    expect(refine(c15, fx, withGate(applied, { wet: -100, dry: 0 }))?.changes.some((c) => c.reason === 'gateDoubled')).toBe(false)
  })

  it('quieter never pushes the speech past the middle of the good level range (-21 dBFS)', () => {
    const loudRaw = sessionTake(20, 'c15', 'Control · 15 cm · raw', fakeAnalysis({ ...raw, speechMed: -14 }))
    const fxAt = (speechMed: number): Take => sessionTake(21, 'fx', 'Processed · 15 cm · Record Mix', fakeAnalysis({ ...raw, speechMed, snr: raw.snr + 3 }))
    // dropped 10 dB to -24: only 3 dB up, to land on -21
    const r = refine(loudRaw, fxAt(-24), applied)
    expect(r?.changes.find((c) => c.reason === 'quieter')?.msg.params).toEqual({ drop: 10, db: 3, to: 5 })
    // dropped 7 dB to -21: already on target, no change
    const none = refine(loudRaw, fxAt(-21), applied)
    expect(none?.changes.some((c) => c.reason === 'quieter')).toBe(false)
    expect(none?.settings.comp.wet).toBe(2)
  })

  it('quieter from 4 dB: Wet goes up by the drop, never above 18', () => {
    // SNR + 3: not still noisy, and not enough to count as improved
    expect(refine(c15, fxOf({ speechMed: raw.speechMed - 3.9, snr: raw.snr + 3 }), applied)?.settings.comp.wet).toBe(2)
    expect(refine(c15, fxOf({ speechMed: raw.speechMed - 5, snr: raw.snr + 3 }), applied)?.settings.comp.wet).toBe(7)
    const loud = { ...applied, settings: { ...applied.settings, comp: { ...applied.settings.comp, wet: 10 } } }
    const r = refine(c15, fxOf({ speechMed: raw.speechMed - 12 }), loud)
    expect(r?.settings.comp.wet).toBe(18)
    expect(r?.changes.find((c) => c.reason === 'quieter')?.msg.params).toEqual({ drop: 12, db: 8, to: 18 })
  })

  it('thin: the bass cuts move toward 0, past it only when the goal wants more bass', () => {
    const rel = [...raw.rel]
    rel[1] -= 30
    rel[2] -= 30
    const fx = fxOf({ rel, snr: raw.snr + 10 })
    const natural = refine(c15, fx, applied)
    // level matching lifts the other bands, so the take also reads harsh
    expect(reasons(natural)).toEqual(['thin', 'thin', 'harsh'])
    expect([band(natural, 'Low Shelf', 150)?.gain, band(natural, 'Band', 250)?.gain]).toEqual([0, 0])
    const warm = refine(c15, fx, applied, { style: 'warm', perceived: [] })
    expect([band(warm, 'Low Shelf', 150)?.gain, band(warm, 'Band', 250)?.gain]).toEqual([3, 2])
    const heard = refine(c15, fx, applied, { style: 'natural', perceived: ['thin'] })
    expect(band(heard, 'Low Shelf', 150)?.gain).toBe(1.5)
  })

  it('harsh: presence band and high shelf down by 0.7 x the rise, not below -4', () => {
    const rel = [...raw.rel]
    rel[6] += 8 // presence deviation rises by 8 x 6/7 ~ 6.9 dB after level matching
    const mild = { ...applied, settings: { ...applied.settings, eq: applied.settings.eq.map((e) => (e.type === 'High Shelf' ? { ...e, gain: 1 } : e)) } }
    const r = refine(c15, fxOf({ rel, snr: raw.snr + 10 }), mild)
    expect(reasons(r)).toEqual(['harsh', 'harsh'])
    // 0.7 x 6.86 = 4.8: the new presence band floors at -4, the +1 dB shelf goes to 1 - 4.8 = -3.8 -> -4 (rounded to 0.5, floored)
    expect(band(r, 'Band', 3500)?.gain).toBe(-4)
    expect(band(r, 'High Shelf', 10000)?.gain).toBe(-4)
    const tiny = refine(c15, fxOf({ rel: raw.rel.map((v, i) => (i === 6 ? v + 7.2 : v)), snr: raw.snr + 10 }), mild)
    // rise 6.17 -> cut 4.3: presence band -4, shelf 1 - 4.3 = -3.3 -> -3.5
    expect(band(tiny, 'High Shelf', 10000)?.gain).toBe(-3.5)
  })

  it('still noisy without regressions: ReaFIR 3 dB more, then AI; AI added when there was none', () => {
    const fx = fxOf({ snr: raw.snr + 2 })
    expect(keys(refine(c15, fx, applied))).toEqual(['plain.refine.stillNoisy.reafirMore'])
    const r2 = refine(c15, fx, withAttempt(applied, 2))
    expect([keys(r2), r2?.noiseRemoval]).toEqual([['plain.refine.stillNoisy.toAi'], 'ai-elgato'])
    const r3 = refine(c15, fx, withAttempt(applied, 1, { noiseRemoval: 'none' }))
    expect([keys(r3), r3?.noiseRemoval]).toEqual([['plain.refine.stillNoisy.addAi'], 'ai-elgato'])
    expect(keys(refine(c15, fx, withAttempt(applied, 1, { noiseRemoval: 'ai-nvidia' })))).toEqual(['plain.refine.stillNoisy.aiStronger'])
    // enough SNR gained: not still noisy
    expect(refine(c15, fxOf({ snr: raw.snr + 3 }), applied)?.changes).toEqual([])
  })
})

/** Messages of the too-loud session, plus "another effect cuts the sound" (no noise removal, gate off). */
function clippedMsgs(): Msg[] {
  const cs = clippedSession()
  const choppedFx = sessionTake(13, 'fx', cs.fx.name, fakeAnalysis({ ...(cs.c15.analysis as Analysis), zeroRatio: 0.2 }))
  const wet0 = { ...cs.applied, settings: { ...cs.applied.settings, comp: { ...cs.applied.settings.comp, wet: 0 } } }
  return [
    ...refine(cs.c15, cs.fx, cs.applied)!.changes,
    ...refine(cs.c15, choppedFx, { ...cs.applied, noiseRemoval: 'none' })!.changes,
    ...refine(cs.c15, cs.fx, wet0)!.changes,
  ].map((c) => c.msg)
}

describe('refine copy', () => {
  const lookup = (tree: unknown, key: string): string | undefined => {
    let node = tree
    for (const part of key.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    return typeof node === 'string' ? node : undefined
  }
  const names = (s: string): string[] => [...s.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((m) => m[1]).sort()

  it('every message refine returns exists in en and pt-BR with the params it uses', () => {
    const { c15, fx, applied } = realSession()
    const raw = c15.analysis as Analysis
    const fxOf = (over: Partial<Analysis>): Take => sessionTake(9, 'fx', 'Processed · 15 cm · Record Mix', fakeAnalysis({ ...raw, ...over }))
    const quietFx = fxOf({ snr: raw.snr })
    const msgs: Msg[] = [
      ...[1, 2].flatMap((n) => refine(c15, fx, withAttempt(applied, n))!.changes.map((c) => c.msg)),
      ...refine(c15, fx, { ...applied, dist: '2 cm' })!.changes.map((c) => c.msg),
      ...clippedMsgs(),
      ...refine(c15, fxOf({ rel: raw.rel.map((v, i) => (i === 6 ? v + 12 : i === 1 ? v - 30 : v)), snr: raw.snr + 10 }), applied)!.changes.map((c) => c.msg),
      ...refine(c15, fxOf({ rel: raw.rel.map((v, i) => (i === 6 ? v + 12 : v)), snr: raw.snr + 10 }), {
        ...applied, settings: { ...applied.settings, eq: applied.settings.eq.map((e) => (e.type === 'High Shelf' ? { ...e, gain: 1 } : e)) },
      })!.changes.map((c) => c.msg),
      ...(['reafir', 'none', 'ai-elgato'] as const).flatMap((nr) => [1, 2].flatMap((n) => refine(c15, quietFx, withAttempt(applied, n, { noiseRemoval: nr }))!.changes.map((c) => c.msg))),
      ...changeApproachAdvice(),
    ]
    const found = new Set(msgs.map((m) => m.key))
    const all: string[] = []
    const walk = (node: unknown, prefix: string): void => {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (typeof v === 'string') all.push(prefix + k)
        else walk(v, `${prefix}${k}.`)
      }
    }
    walk(en.plain.refine, 'plain.refine.')
    expect(all.filter((k) => !found.has(k)), 'en keys refine never returns').toEqual([])
    for (const m of msgs) {
      for (const tree of [en, pt]) {
        const s = lookup(tree, m.key)
        expect(s, m.key).toBeTypeOf('string')
        for (const n of names(s!)) expect(m.params?.[n], `${m.key} {{${n}}}`).toBeDefined()
      }
      expect(names(lookup(en, m.key)!)).toEqual(names(lookup(pt, m.key)!))
    }
  })
})
