// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import en from '../i18n/locales/en/plain.json'
import pt from '../i18n/locales/pt-BR/plain.json'
import { DEFAULT_GOAL, type Analysis, type AppliedSettings, type Take } from '../types'
import { changeApproachAdvice, evaluateProcessed, refine } from './refine'
import { realSession, sessionTake } from './testFixtures'
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

  it('a processed take at another distance than the raw reference is not used to judge the settings', () => {
    const { c2, fx, applied } = realSession()
    const ev = evaluateProcessed(c2, fx, applied)
    expect(ev?.mismatch).toMatchObject({ expected: '2 cm', actual: '15 cm' })
    expect(ev?.improved).toBe(false)
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
    const { c2, fx, applied } = realSession()
    const r = refine(c2, fx, applied)
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

  it('attempt 2 still chopped: switch to AI noise removal and turn the gate off (dry 0)', () => {
    const { c15, fx, applied } = realSession()
    const r = refine(c15, fx, withAttempt(applied, 2))
    expect(keys(r)?.slice(0, 2)).toEqual(['plain.refine.chopped.toAi', 'plain.refine.chopped.gateOff'])
    expect(r?.noiseRemoval).toBe('ai-elgato')
    expect(r?.settings.gate).toMatchObject({ threshold: -41, dry: 0 })
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
    const { c2, fx, applied } = realSession()
    expect(reasons(refine(c2, fx, withAttempt(applied, 3)))).toEqual(['wrongDistance'])
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
    expect(r?.settings.gate).toMatchObject({ threshold: -72, dry: 0 })
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

describe('refine copy', () => {
  const lookup = (tree: unknown, key: string): string | undefined => {
    let node = tree
    for (const part of key.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    return typeof node === 'string' ? node : undefined
  }
  const names = (s: string): string[] => [...s.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((m) => m[1]).sort()

  it('every message refine returns exists in en and pt-BR with the params it uses', () => {
    const { c2, c15, fx, applied } = realSession()
    const raw = c15.analysis as Analysis
    const fxOf = (over: Partial<Analysis>): Take => sessionTake(9, 'fx', 'Processed · 15 cm · Record Mix', fakeAnalysis({ ...raw, ...over }))
    const quietFx = fxOf({ snr: raw.snr })
    const msgs: Msg[] = [
      ...[1, 2].flatMap((n) => refine(c15, fx, withAttempt(applied, n))!.changes.map((c) => c.msg)),
      ...refine(c2, fx, applied)!.changes.map((c) => c.msg),
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
