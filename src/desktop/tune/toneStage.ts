// The tone stage: ReaEQ gains (and, when gains alone cannot do it, a band's frequency and width) toward the goal's
// target, planned on the take's own spectrum, corrected by what each band really did in a render, and kept only when
// the rendered tone is measurably closer.
import { median } from '../../audio/dsp'
import { BANDS } from '../../audio/reference'
import { eqKey, sameValue } from '../advice/chain'
import { calibrate, EqCurves, eqHandles, NO_BOOST_SNR, NOISY_SNR, planShaped, predictBands, reshape, sameShape, SHAPE_OCT, SHAPE_VOICE_HZ, shapeVariants, touched, type EqHandle, type TonePlan } from './eqModel'
import { bandsOfCells, toneAt, toneLevel, type Measured } from './measure'
import { shapeReasonMsg, toneReasonMsg } from './msgs'
import { toneOf } from './score'
import type { Move, Session } from './session'
import { tryWithGates } from './stages'
import { N_BANDS, toneExcess, toneJudge, type TuneTargets } from './targets'

/** No band may end this much further outside its tolerance than it was, dB ("other bands not worsened"). */
export const OTHER_BAND_TOL_DB = 1

export interface ToneNotes {
  /** No tunable ReaEQ band in the chain. */
  noEq: boolean
  /** Per BANDS index: some tunable EQ band reaches it, where it is or moved onto it. */
  reach: boolean[]
  /**
   * No plan was kept and even the gentlest one rendered cost this much voice over the pauses, dB: cutting the loudest
   * part of a voice makes the whole voice quieter against the room (on the real chain 5.8 dB for the 160–320 Hz hump).
   */
  roomCostDb?: number
}

/** Plans one run of the stage may render (the stage's share of the budget covers two runs: with and without a ReaFIR). */
export const TONE_PASSES = 4

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
function targetBand(d: readonly number[], shifted: readonly number[], excess: readonly number[]): number {
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

/** A Band can be moved onto this BANDS index: its centre is within SHAPE_OCT of the band's and inside the voice range. */
const movable = (h: EqHandle, band: number): boolean => {
  const hz = Math.sqrt(BANDS[band].lo * BANDS[band].hi)
  return h.type === 'Band' && Math.abs(Math.log2(hz / h.baseFreqHz)) <= SHAPE_OCT && hz >= SHAPE_VOICE_HZ[0] && hz <= SHAPE_VOICE_HZ[1]
}

const shapeKey = (p: TonePlan): string => p.curves.handles.map((h, i) => `${p.gains[i]}@${h.freqHz}/${h.bwOct}`).join(',')

/**
 * Tone, at most TONE_PASSES plans rendered:
 * 1. Nothing outside its tolerance → nothing to do. No tunable ReaEQ band → noted for the unmet list.
 * 2. Plan on the measured spectrum with each band's nominal curve (planShaped): the gains first; while they leave a
 *    band out of tolerance, a band's frequency (within an octave of where it is, inside the voice range) and width
 *    (0.3–2.5 oct) too, so a narrow cut can sit on a hump without thinning the hole next to it and a lift can be put
 *    where the voice is missing. A shelf stays a shelf. The amount's caps count how far the band's whole curve moved.
 * 3. Render the plan. Keep it when the tone score improves and no band ends more than OTHER_BAND_TOL_DB further
 *    outside its tolerance than before, aligned on what the plan predicted for each band (alignedTone: what the EQ
 *    did to it, beyond what was planned).
 * 4. Fit what each moved band REALLY did in that render (calibrate) and plan again from the stage's start with the
 *    fitted strengths: a band that did less than its curve is pushed further or dropped, one that did the opposite
 *    is dropped. A new plan is rendered and replaces the kept one only if it measures better still.
 * The score is taken against toneJudge(targets): a plan may cost voice over the room while it stays at the use's own
 * target (30 dB, calls 25), whatever "room noise" wishes for; one that is rejected and ends under it gets the gate
 * placed again first (tryWithGates).
 * No band moves against a complaint (respectBothers: boomy never lifts the low bands).
 * In a noisy room (SNR under 25 dB) a band whose voice-over-room SNR is under 12 dB is never boosted (suggest()). A
 * plan that cost LIFT_NOISE_DB of voice over the pauses is planned again without lifting such bands at all
 * (withoutLifts).
 */
export async function toneStage(s: Session): Promise<ToneNotes> {
  const t = s.targets
  const a = s.mask.analysis
  const noisy = a.snr < NOISY_SNR
  const noBoost = (band: number): boolean => noisy && a.bandSnr[band] < NO_BOOST_SNR
  const roomLoud = (band: number): boolean => a.bandSnr[band] < NO_BOOST_SNR
  const home = eqHandles(s.chain, t.caps.eqStepDb, noBoost)
  const mk = (hs: readonly EqHandle[]): EqCurves => new EqCurves(hs, s.mask.cellHz, s.mask.sampleRate)
  const homeCurves = mk(respectBothers(home, t))
  const notes: ToneNotes = {
    noEq: home.length === 0,
    reach: Array.from({ length: N_BANDS }, (_, b) => home.some((h, i) => homeCurves.reaches(i)[b] || movable(h, b))),
  }
  const startM = s.m
  if (startM.silent) return notes
  const tone0 = toneOf(startM, t)
  const excess0 = toneExcess(tone0, t)
  if (!excess0.some((e, i) => e * t.weight[i] > 0)) return notes
  if (!home.length) {
    s.note('tone', 'skip', 'no tunable ReaEQ band in the chain')
    return notes
  }
  const shifted = tone0.map((d, i) => d + t.shift[i])
  /** The handles' bounds: never against a complaint, and after a plan lifted the room, no lift where it is loud. */
  let lifted = false
  const bound = (hs: readonly EqHandle[]): EqHandle[] => respectBothers(lifted ? withoutLifts(hs, roomLoud) : hs, t)
  /**
   * Handle `i` at a frequency / width (the chain's own: the handle as it started). A band that may not be lifted (or
   * cut) where the chain has it may not be either once moved: a shelf slid down under a band the person hears as too
   * much would lift it all the same.
   */
  const at = (i: number, freqHz: number, bwOct: number): EqHandle => {
    const own = bound([home[i]])[0]
    const h = bound([reshape(home[i], freqHz, bwOct, noBoost)])[0]
    if (sameShape(h)) return h
    // at its new place the band answers for every tone band its curve reaches there, from 0 dB: a cut it carried is
    // not taken along onto a band the person hears as too little, nor a lift onto one they hear as too much
    const reach = mk([h]).reaches(0)
    const noLift = own.hi <= own.base || reach.some((r, b) => r && (t.shift[b] > 0 || (lifted ? roomLoud(b) : noBoost(b))))
    const noCut = own.lo >= own.base || reach.some((r, b) => r && t.shift[b] < 0)
    return { ...h, lo: noCut ? Math.max(h.lo, 0) : h.lo, hi: noLift ? Math.min(h.hi, 0) : h.hi }
  }
  const value = (h: EqHandle, field: 'freqHz' | 'bwOct' | 'gainDb'): number => s.value(h.slot, eqKey(h.n, field))
  // where the stage starts: the kept shapes and gains (the chain's own, or a previous result's on a retune)
  const startShape = home.map((h) => ({ freqHz: value(h, 'freqHz'), bwOct: value(h, 'bwOct') }))
  const startCurves = (): EqCurves => mk(home.map((_h, i) => at(i, startShape[i].freqHz, startShape[i].bwOct)))
  const startGains = home.map((h) => value(h, 'gainDb'))
  const variants = (i: number, bands: readonly number[]): EqHandle[] => {
    const here = at(i, startShape[i].freqHz, startShape[i].bwOct)
    const back = sameShape(here) ? [] : [{ freqHz: home[i].baseFreqHz, bwOct: home[i].baseBwOct }]
    return [...back, ...shapeVariants(here, bands)].map((v) => at(i, v.freqHz, v.bwOct))
  }
  /** The stage's keep check for a plan `to` over the kept one `from` (alignedTone on the plan's predicted change per band). */
  const noWorse =
    (from: TonePlan, to: TonePlan, strength: readonly number[]) =>
    (b: Measured, m: Measured): string | null => {
      const bb = bandsOfCells(b.cells)
      const predicted = predictBands(b.cells, to.curves.delta(from.gains, to.gains, strength, from.curves)).map((v, k) => v - bb[k])
      const [eb, ea] = alignedTone(b, m, predicted, t).map((d) => toneExcess(d, t))
      const i = ea.findIndex((e, k) => t.weight[k] > 0 && e > eb[k] + OTHER_BAND_TOL_DB)
      return i < 0 ? null : `band ${i} ended ${(ea[i] - eb[i]).toFixed(1)} dB further off`
    }

  // the room may give way to the tone down to the use's own target ("room noise" asks the noise stage for more)
  const judge = toneJudge(t)
  let rho = home.map(() => 1)
  let kept: TonePlan = { curves: startCurves(), gains: startGains }
  let keptAny = false
  let roomCost = Infinity
  const tried = new Set<string>()
  for (let pass = 0; pass < TONE_PASSES; pass++) {
    const was = startCurves()
    const plan = planShaped(was, startM.cells, startGains, rho, t, t.caps.eqTotalDb, variants)
    const key = shapeKey(plan)
    if (tried.has(key) || key === shapeKey(kept)) break
    tried.add(key)
    const moves: Move[] = plan.curves.handles.flatMap((h: EqHandle, i): Move[] => {
      const k = kept.curves.handles[i]
      const gain = !sameValue(plan.gains[i], kept.gains[i])
      const freq = h.freqHz !== k.freqHz
      const width = h.bwOct !== k.bwOct
      if (!gain && !freq && !width) return []
      // what the band does from where the stage found it (back at the start: what undoing the kept move does)
      const back = sameValue(plan.gains[i], startGains[i]) && h.freqHz === was.handles[i].freqHz && h.bwOct === was.handles[i].bwOct
      const d = back ? plan.curves.bandDelta(i, kept.gains[i], plan.gains[i], kept.curves) : plan.curves.bandDelta(i, startGains[i], plan.gains[i], was)
      const band = targetBand(d, shifted, excess0)
      const titleMsg = sameShape(h) ? toneReasonMsg(band, plan.gains[i] < h.base ? 'high' : 'low', Math.abs(plan.gains[i] - h.base)) : shapeReasonMsg(band, d[band] < 0 ? 'high' : 'low')
      const move = (field: 'freqHz' | 'bwOct' | 'gainDb', to: number): Move => ({ slot: h.slot, key: eqKey(h.n, field), to, reason: 'tone', titleMsg, metric: 'tone', band })
      return [...(gain ? [move('gainDb', plan.gains[i])] : []), ...(freq ? [move('freqHz', h.freqHz)] : []), ...(width ? [move('bwOct', h.bwOct)] : [])]
    })
    const before = s.m
    const renders = s.renders
    const r = await tryWithGates(s, 'tone', moves, 'tone', noWorse(kept, plan, rho), judge)
    if (r === 'budget' || r === 'same') break
    if (r === 'kept') {
      kept = plan
      keptAny = true
    } else if (s.renders > renders) roomCost = Math.min(roomCost, before.snrDb - s.last.snrDb)
    if (r === 'reverted' && !lifted && s.renders > renders && s.last.snrDb < before.snrDb - LIFT_NOISE_DB) {
      lifted = true
      s.note('tone', 'info', `that plan brought the room up (voice over pauses ${before.snrDb.toFixed(1)} → ${s.last.snrDb.toFixed(1)} dB): planning again without lifting bands where the room is loud`)
    }
    rho = calibrate(plan.curves, startM.cells, s.last.cells, startGains, plan.gains, rho, was)
    s.note('tone', 'info', `what each band did vs its curve: ${plan.curves.handles.map((h, i) => `${h.type} ${Math.round(h.freqHz)} Hz ×${rho[i].toFixed(2)}`).join(', ')}`)
  }
  return !keptAny && Number.isFinite(roomCost) && roomCost >= LIFT_NOISE_DB ? { ...notes, roomCostDb: roomCost } : notes
}
