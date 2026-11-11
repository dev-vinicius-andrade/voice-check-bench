// Tone advice: the guide's ReaEQ moves (src/settings/suggest.ts) applied to the live tone vs the goal, only for what
// the person hears (goal.perceived). Pure.
// The live tone (HeldSide.tone) is already targetDeviations against the goal, measured after the current EQ, so a band
// moves from its current gain by the suggest rule (−0.7 × deviation, HARSH_K) inside the suggest ranges.
import { TONE_BANDS, TONE_MAX_DB } from '../../live/hints'
import { CONFIRM_DB } from '../../plain/perceived'
import { HARSH_K } from '../../plain/refine'
import type { PerceivedIssue, VoiceGoal } from '../../types'
import type { EqTypeName } from '../../wavelink/fxp'
import { eqBands, eqKey, slotsWith, type EqBandView } from './chain'
import { eqChangeMsg, titleMsg, valueAdvice } from './msgs'
import type { Advice, ChainSlot } from './types'

type ToneKey = (typeof TONE_BANDS)[number]['key']

/**
 * The ReaEQ band each tone band moves, with the gain range suggest() gives it (Low Shelf 150 Hz −8..+2, Band 250 Hz
 * −6..+3, Band 450 Hz −5..+3, Band 3500 Hz −4..+5, High Shelf 10 kHz −4..+5), and the perceived issue (VoiceGoal)
 * each direction confirms (perceived.ts: boomy = boom/warmth high, thin = low, muffled = mud high or presence low,
 * harsh = presence high, sharpS = sibilance high, dull = sibilance low).
 */
export const TONE_EQ: Readonly<Record<ToneKey, { type: EqTypeName; freq: number; lo: number; hi: number; high: PerceivedIssue; low: PerceivedIssue | null }>> = {
  boom: { type: 'Low Shelf', freq: 150, lo: -8, hi: 2, high: 'boomy', low: 'thin' },
  warmth: { type: 'Band', freq: 250, lo: -6, hi: 3, high: 'boomy', low: 'thin' },
  mud: { type: 'Band', freq: 450, lo: -5, hi: 3, high: 'muffled', low: null },
  presence: { type: 'Band', freq: 3500, lo: -4, hi: 5, high: 'harsh', low: 'muffled' },
  sibilance: { type: 'High Shelf', freq: 10000, lo: -4, hi: 5, high: 'sharpS', low: 'dull' },
}

/** A band of the right type up to this many octaves from the guide's frequency still counts (the person may have moved it). */
export const BAND_MATCH_OCT = 0.5

const r05 = (v: number): number => Math.round(v * 2) / 2 || 0
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))

/** The enabled ReaEQ band nearest to the guide's band (same type, within BAND_MATCH_OCT), across the switched-on ReaEQs. */
function findBand(chain: readonly ChainSlot[], type: EqTypeName, freq: number): { slot: ChainSlot; band: EqBandView } | null {
  let best: { slot: ChainSlot; band: EqBandView; dist: number } | null = null
  for (const slot of slotsWith(chain, 'reaeq')) {
    for (const band of eqBands(slot)) {
      if (!band.on || band.type !== type || !(band.freqHz > 0) || !Number.isFinite(band.gainDb)) continue
      const dist = Math.abs(Math.log2(band.freqHz / freq))
      if (dist <= BAND_MATCH_OCT && (!best || dist < best.dist)) best = { slot, band, dist }
    }
  }
  return best
}

export interface ToneOptions {
  /** Largest move per band, dB (AMOUNT_STEP_DB of the person's "How much processing"); default TONE_MAX_DB. */
  maxStepDb?: number
  /** Seconds of talk the tone was seen in (trendTone); carried on each advice. */
  evidenceSec?: number
}

/**
 * EQ advice for the tone bands of live hints (boom, warmth, mud, presence, sibilance), biggest deviation first.
 * A band only gets advice when the person picked the issue its direction means (TONE_EQ high/low vs goal.perceived)
 * and it is more than CONFIRM_DB (1.5 dB) off the goal that way: tone never moves toward an average curve nobody asked
 * for. The move is −dev × HARSH_K (0.7), rounded to 0.5 dB, at most maxStepDb, kept in the suggest range and only in
 * the direction that helps. `clipped`: harshness from clipping is fixed by the level first (refine's "harsh from
 * clipping"), so presence and sibilance are not cut.
 */
export function toneAdvice(tone: readonly number[], chain: readonly ChainSlot[], goal: VoiceGoal, clipped: boolean, opts: ToneOptions = {}): Advice[] {
  const heard = new Set(goal.perceived ?? [])
  const maxStep = opts.maxStepDb ?? TONE_MAX_DB
  const out: { dev: number; advice: Advice }[] = []
  for (const { band: bi, key } of TONE_BANDS) {
    const dev = tone[bi]
    if (!Number.isFinite(dev) || dev === 0) continue
    const eq = TONE_EQ[key]
    const high = dev > 0
    const issue = high ? eq.high : eq.low
    const mag = Math.abs(dev)
    if (issue === null || !heard.has(issue) || !(mag > CONFIRM_DB)) continue
    if (clipped && high && (key === 'presence' || key === 'sibilance')) continue
    const found = findBand(chain, eq.type, eq.freq)
    if (!found) continue
    const from = found.band.gainDb
    const step = Math.min(maxStep, r05(mag * HARSH_K))
    const to = clamp(r05(from + (high ? -step : step)), eq.lo, eq.hi)
    if (high ? !(to < from) : !(to > from)) continue
    const n = found.band.n
    const title = titleMsg(`tone.${high ? 'high' : 'low'}.${key}`, { db: Math.abs(to - from) })
    const change = eqChangeMsg(found.slot, eq.type, Math.round(found.band.freqHz), from, to)
    const advice = valueAdvice('tone', found.slot, eqKey(n, 'gainDb'), to, title, change)
    out.push({ dev, advice: opts.evidenceSec === undefined ? advice : { ...advice, evidenceSec: opts.evidenceSec } })
  }
  return out.sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)).map((x) => x.advice)
}
