// The tone stage: ReaEQ gains toward the goal's target, planned on the take's own spectrum, corrected by what each
// band really did in a render, and kept only when the rendered tone is measurably closer.
import { sameValue } from '../advice/chain'
import { calibrate, EqCurves, eqHandles, NO_BOOST_SNR, NOISY_SNR, planTone, predictBands, touched, type EqHandle } from './eqModel'
import { median } from '../../audio/dsp'
import { bandsOfCells, toneAt, toneLevel, type Measured } from './measure'
import { toneReasonMsg } from './msgs'
import { toneOf } from './score'
import { STAGE_RENDERS, type Move, type Session } from './session'
import { tryWithGates } from './stages'
import { N_BANDS, toneExcess, type TuneTargets } from './targets'

/** No band may end this much further outside its tolerance than it was, dB ("other bands not worsened"). */
export const OTHER_BAND_TOL_DB = 1

export interface ToneNotes {
  /** No tunable ReaEQ band in the chain. */
  noEq: boolean
  /** Per BANDS index: some tunable EQ band reaches it. */
  reach: boolean[]
}

/** A plan that cost this much voice over the room was lifting the room with the voice, dB. */
export const LIFT_NOISE_DB = 1

/**
 * The handles with no gain above where the chain had it on those that move a band where the room is loud
 * (`noisy`): un-cutting a stored cut lifts the room exactly like a boost. After a plan measurably brought the room up
 * (on the real chain opening a −4 dB high shelf cost 2 dB of voice over the pauses for someone who picked "room
 * noise"), the stage plans again with these.
 */
export function withoutLifts(handles: readonly EqHandle[], noisy: (band: number) => boolean): EqHandle[] {
  return handles.map((h) => (touched(h).some(noisy) ? { ...h, hi: Math.max(h.lo, Math.min(h.hi, h.base)) } : h))
}

/**
 * The handles with no move against what the person said: no lift on a band they hear as too much (boomy → boom and
 * warmth), no cut on one they hear as too little. On the second real take a "boomy" run lifted the 150 Hz low shelf
 * because a noise profile upstream had hollowed out 80–160 Hz; whatever the meter says, that is the opposite of what
 * was asked.
 */
export function respectBothers(handles: readonly EqHandle[], t: TuneTargets): EqHandle[] {
  return handles.map((h) => {
    const bands = touched(h)
    const lo = bands.some((b) => t.shift[b] < 0) ? Math.min(h.hi, Math.max(h.lo, h.base)) : h.lo
    const hi = bands.some((b) => t.shift[b] > 0) ? Math.max(lo, Math.min(h.hi, h.base)) : h.hi
    return lo === h.lo && hi === h.hi ? h : { ...h, lo, hi }
  })
}

/** Speech bands (boom … air) the alignment uses. */
const SPEECH_BANDS = [1, 2, 3, 4, 5, 6, 7, 8]

/**
 * The tone of two renders, before → after an EQ move, the after one matched at the before one's level shifted by the
 * median gap between each band's measured and predicted change (`predicted`: dB per band, from the plan's curves).
 * What the plan meant to do then reads as planned, and a band the EQ did something else to stands out. Re-matching
 * each render on its own median would move bands nobody touched when a cut reaches the median band (on the real chain
 * a 250 Hz cut lowered 320–640 Hz and presence read 2 dB higher); a fixed level would read a compressor after the EQ
 * giving the level back as every band rising.
 */
export function alignedTone(b: Measured, a: Measured, predicted: readonly number[], t: TuneTargets): [number[], number[]] {
  const bb = bandsOfCells(b.cells)
  const ba = bandsOfCells(a.cells)
  const lb = toneLevel(bb, t.style)
  const gaps = SPEECH_BANDS.map((k) => ba[k] - bb[k] - predicted[k]).filter(Number.isFinite)
  const la = gaps.length >= 3 ? lb + median(gaps) : toneLevel(ba, t.style)
  return [toneAt(bb, t.style, lb), toneAt(ba, t.style, la)]
}

/** The band a move is for: the out-of-tolerance band its curve moves most the right way, else where its curve is strongest. */
function targetBand(curves: EqCurves, i: number, from: number, to: number, shifted: readonly number[], excess: readonly number[]): number {
  const d = curves.bandDelta(i, from, to)
  let best = 1
  let bestHelp = -Infinity
  for (let b = 1; b < N_BANDS; b++) {
    const helps = excess[b] > 0 && Math.sign(d[b]) === -Math.sign(shifted[b])
    const help = Math.abs(d[b]) * (helps ? 1 : 1e-3)
    if (help > bestHelp) {
      bestHelp = help
      best = b
    }
  }
  return best
}

/**
 * Tone, at most STAGE_RENDERS.tone renders:
 * 1. Nothing outside its tolerance → nothing to do. No tunable ReaEQ band → noted for the unmet list.
 * 2. Plan the gains on the measured spectrum with each band's nominal curve (planTone).
 * 3. Render the plan. Keep it when the tone score improves and no band ends more than OTHER_BAND_TOL_DB further
 *    outside its tolerance than before, aligned on what the plan predicted for each band (alignedTone: what the EQ
 *    did to it, beyond what was planned).
 * 4. Fit what each moved band REALLY did in that render (calibrate) and plan again from the stage's start with the
 *    fitted strengths: a band that did less than its curve is pushed further or dropped, one that did the opposite
 *    is dropped. A new plan is rendered and replaces the kept one only if it measures better still.
 * No band moves against a complaint (respectBothers: boomy never lifts the low bands).
 * In a noisy room (SNR under 25 dB) a band whose voice-over-room SNR is under 12 dB is never boosted (suggest()). A
 * plan that cost LIFT_NOISE_DB of voice over the pauses is planned again without lifting such bands at all
 * (withoutLifts).
 */
export async function toneStage(s: Session): Promise<ToneNotes> {
  const t = s.targets
  const a = s.mask.analysis
  const noisy = a.snr < NOISY_SNR
  const handles = respectBothers(eqHandles(s.chain, t.caps.eqStepDb, (band) => noisy && a.bandSnr[band] < NO_BOOST_SNR), t)
  const curves = new EqCurves(handles, s.mask.cellHz, s.mask.sampleRate)
  const notes: ToneNotes = {
    noEq: handles.length === 0,
    reach: Array.from({ length: N_BANDS }, (_, b) => handles.some((_h, i) => curves.reaches(i)[b])),
  }
  const startM = s.m
  if (startM.silent) return notes
  const tone0 = toneOf(startM, t)
  const excess0 = toneExcess(tone0, t)
  if (!excess0.some((e, i) => e * t.weight[i] > 0)) return notes
  if (!handles.length) {
    s.note('tone', 'skip', 'no tunable ReaEQ band in the chain')
    return notes
  }
  const shifted = tone0.map((d, i) => d + t.shift[i])
  const start = handles.map((h) => s.value(h.slot, h.key))
  const current = (): number[] => handles.map((h) => s.value(h.slot, h.key))
  /** The stage's keep check for gains `from` → `to` (alignedTone on the plan's predicted change per band). */
  const noWorse =
    (from: readonly number[], to: readonly number[], strength: readonly number[]) =>
    (b: Measured, m: Measured): string | null => {
      const bb = bandsOfCells(b.cells)
      const predicted = predictBands(b.cells, curves.delta(from, to, strength)).map((v, k) => v - bb[k])
      const [eb, ea] = alignedTone(b, m, predicted, t).map((d) => toneExcess(d, t))
      const i = ea.findIndex((e, k) => t.weight[k] > 0 && e > eb[k] + OTHER_BAND_TOL_DB)
      return i < 0 ? null : `band ${i} ended ${(ea[i] - eb[i]).toFixed(1)} dB further off`
    }

  let rho = handles.map(() => 1)
  let planner = curves
  const tried = new Set<string>()
  for (let pass = 0; pass < STAGE_RENDERS.tone; pass++) {
    const plan = planTone(planner, startM.cells, start, rho, t, t.caps.eqTotalDb)
    const key = plan.join(',')
    const now = current()
    if (tried.has(key) || plan.every((g, i) => sameValue(g, now[i]))) break
    tried.add(key)
    const moves: Move[] = handles.flatMap((h: EqHandle, i): Move[] => {
      if (sameValue(plan[i], now[i])) return []
      const band = targetBand(curves, i, start[i], sameValue(plan[i], start[i]) ? now[i] : plan[i], shifted, excess0)
      const cut = plan[i] < h.base
      return [{ slot: h.slot, key: h.key, to: plan[i], reason: 'tone', titleMsg: toneReasonMsg(band, cut ? 'high' : 'low', Math.abs(plan[i] - h.base)), metric: 'tone', band }]
    })
    const kept = s.m
    const renders = s.renders
    const r = await tryWithGates(s, 'tone', moves, 'tone', noWorse(now, plan, rho))
    if (r === 'budget' || r === 'same') break
    if (r === 'reverted' && planner === curves && s.renders > renders && s.last.snrDb < kept.snrDb - LIFT_NOISE_DB) {
      planner = new EqCurves(withoutLifts(handles, (b) => a.bandSnr[b] < NO_BOOST_SNR), s.mask.cellHz, s.mask.sampleRate)
      s.note('tone', 'info', `that plan brought the room up (voice over pauses ${kept.snrDb.toFixed(1)} → ${s.last.snrDb.toFixed(1)} dB): planning again without lifting bands where the room is loud`)
    }
    rho = calibrate(curves, startM.cells, s.last.cells, start, plan, rho)
    s.note('tone', 'info', `what each band did vs its curve: ${handles.map((h, i) => `${h.type} ${Math.round(h.freqHz)} Hz ×${rho[i].toFixed(2)}`).join(', ')}`)
  }
  return notes
}
