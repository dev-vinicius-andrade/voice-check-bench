// Checks ported 1:1 from the prototype diagnose() (docs/prototype/voice-check.html). Pure.
// Text is message keys under `engine.check.<id>.*` (src/i18n/locales/<lang>/engine.json); numbers travel as
// params and the strings format them (`{{v, number(…)}}`), so the UI shows them in the active locale.
import type { Msg } from '../plain/types'
import type { Analysis, Check, CheckId, Status } from '../types'
import { STRONG_TONE_DB } from './analyze'
import { deviations } from './reference'

/** Signed number with one decimal: "+1.5", "-2.0", "0.0". */
export const f1 = (v: number): string => (v > 0 ? '+' : '') + v.toFixed(1)

const msg = (key: string, params?: Msg['params']): Msg => (params ? { key, params } : { key })

/** Band checks in BANDS order (index 1..8); rumble (index 0) has its own rule. */
const BAND_CHECKS: readonly CheckId[] = ['boom', 'warmth', 'mud', 'body', 'definition', 'presence', 'sibilance', 'air']

export function diagnose(a: Analysis): Check[] {
  const C: Check[] = []
  const r = a.rel
  /** `detail`/`fix` are suffixes under engine.check.<id>; fix is dropped when the check is good. */
  const add = (id: CheckId, status: Status, value: Msg | undefined, detail: string, fix: string, params?: Msg['params']): void => {
    const k = `engine.check.${id}`
    const c: Check = { id, status, titleMsg: msg(`${k}.title`), detailMsg: msg(`${k}.${detail}`, params) }
    if (value) c.valueMsg = value
    if (status !== 'good' && fix) c.fixMsg = msg(`${k}.${fix}`, params)
    C.push(c)
  }

  // level
  {
    const v = a.speechMed
    const s: Status = v >= -26 && v <= -16 ? 'good' : v >= -32 && v <= -12 ? 'warn' : 'bad'
    const side = s === 'good' ? 'good' : v < -26 ? 'quiet' : 'hot'
    add('level', s, msg('engine.check.level.value', { v }), side, side === 'quiet' ? 'fixQuiet' : 'fixHot')
  }
  {
    const s: Status = a.clip > 0 ? 'bad' : a.peak > -1 ? 'warn' : 'good'
    add('peaks', s, msg('engine.check.peaks.value', { peak: a.peak, clip: a.clip }), s === 'good' ? 'good' : 'bad', 'fix')
  }
  {
    const n = a.noise
    const s: Status = n < -70 ? 'good' : n < -58 ? 'warn' : 'bad'
    const detail = a.noiseFromQuiet ? (s === 'good' ? 'good' : 'bad') : s === 'good' ? 'roughGood' : 'roughBad'
    add('noise', s, msg('engine.check.noise.value', { noise: n, snr: a.snr }), detail, 'fix')
  }
  if (a.quietBroken) {
    add('silence', 'warn', msg('engine.check.silence.value'), 'detail', 'fix')
  }
  if (a.hum.length) {
    // strongest peak; on a tie the first one wins (analyze lists the local mains family first)
    const w = a.hum.reduce((m, h) => (h.db > m.db ? h : m))
    let s: Status = w.db < 6 ? 'good' : w.db < 12 ? 'warn' : 'bad'
    const gated = a.noise < -75
    if (gated && s === 'bad') s = 'warn'
    add('hum', s, msg('engine.check.hum.value', { hz: w.hz, db: w.db }), s === 'good' ? 'good' : gated ? 'gated' : 'bad', 'fix', { hz: w.hz })
  }
  // noisy-room checks: need a usable silence window (noiseBands are NaN without one)
  if (a.noiseBands.length > 0 && a.noiseBands.every(Number.isFinite)) {
    const strong = a.tones.some((t) => t.db >= STRONG_TONE_DB)
    const s: Status = strong ? 'warn' : 'good'
    const top = a.tones.slice(0, 3)
    const value = top.length
      ? msg(`engine.check.tones.value${top.length}`, Object.fromEntries(top.flatMap((t, i) => [[`hz${i + 1}`, t.hz], [`db${i + 1}`, t.db]])))
      : msg('engine.check.tones.none')
    add('tones', s, value, strong ? 'bad' : 'good', 'fix')
    const v = (a.bandSnr[4] + a.bandSnr[5] + a.bandSnr[6]) / 3
    if (Number.isFinite(v)) {
      const sb: Status = v < 15 ? 'bad' : v < 25 ? 'warn' : 'good'
      add('bandsnr', sb, msg('engine.check.bandsnr.value', { v }), sb, 'fix')
    }
  }

  const dv = deviations(r)
  const vsRef = (v: number): Msg => msg('engine.check.vsReference', { dev: v })
  const grade = (v: number): Status => (Math.abs(v) <= 3 ? 'good' : Math.abs(v) <= 6 ? 'warn' : 'bad')
  {
    const v = dv[0]
    const s: Status = v <= 3 ? 'good' : v <= 8 ? 'warn' : 'bad'
    add('rumble', s, vsRef(v), s === 'good' ? 'good' : 'bad', 'fix')
  }
  BAND_CHECKS.forEach((id, k) => {
    const v = dv[k + 1]
    const s = grade(v)
    const hi = v > 0
    add(id, s, vsRef(v), s === 'good' ? 'good' : hi ? 'high' : 'low', hi ? 'fixHigh' : 'fixLow')
  })
  if (a.sibP95 > -6) {
    add('harsh', 'warn', msg('engine.check.harsh.value', { v: a.sibP95 }), 'detail', 'fix')
  }
  {
    const v = a.spread
    const s: Status = v <= 8 ? 'good' : v <= 12 ? 'warn' : 'bad'
    add('consistency', s, msg('engine.check.consistency.value', { v }), s === 'good' ? 'good' : 'bad', 'fix')
  }
  return C
}

/** Number of bad and warn checks. */
export function countByStatus(checks: readonly Check[]): { bad: number; warn: number } {
  let bad = 0
  let warn = 0
  for (const c of checks) {
    if (c.status === 'bad') bad++
    else if (c.status === 'warn') warn++
  }
  return { bad, warn }
}

/** The first n problems for verdicts: bad ones, then warn ones, never the silence-window note. */
export function topIssues(checks: readonly Check[], n = 3): Check[] {
  const bad = checks.filter((c) => c.status === 'bad')
  const warn = checks.filter((c) => c.status === 'warn')
  return [...bad, ...warn].filter((c) => c.id !== 'silence').slice(0, n)
}
