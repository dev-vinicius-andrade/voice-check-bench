// Switch candidates: a slot switched off or on is tried like any other move — rendered, measured, and kept only when
// the measured score says so. Two tools are known to need it on real chains:
// - ReaFIR (a drawn curve or a noise profile) takes parts of the voice with the noise: whole words on a take its
//   profile does not fit, or a band of the voice (on the real chain 15 dB of 80–160 Hz, which left the 160–320 Hz
//   hump of a close mic standing next to a hole no EQ band could cut without deepening it).
// - Elgato Noise Removal often sits in the chain switched off (on its own bypass) while the room is too loud.
import { OVER_SWITCH_WARN } from '../../audio/diagnose'
import { CHOPPED_ZERO } from '../../plain/refine'
import type { ChainSlot } from '../advice/types'
import { bandsOfCells, type Measured } from './measure'
import { bandRange, reasonMsg } from './msgs'
import { CHOP_OK_DB, REGRESS_TOL, scoreOf, toneOf, worseBecause } from './score'
import { switchMove, type Kept, type Session } from './session'
import { CHOP_MIN_GAIN_DB, DEAD_MIN_GAIN, GATE_OPENED_DB, NOISE_MIN_GAIN_DB, regate, replaceGates } from './stages'
import { BAND_KEYS, nrLadder, toneExcess, toneJudge } from './targets'
import { toneStage, type ToneNotes } from './toneStage'

/** Noise Removal is tried on only when the voice over the pauses misses the target by this much, dB. */
export const NR_ON_MIN_MISS_DB = 1
const NR_ON = 'noiseRemoval on'
/** ReaFIR off is tried only when the tone the EQ reached with it on still scores this many points. */
export const FIR_OFF_MIN_TONE = 3

const dead = (s: Session, m: Measured): boolean => !s.targets.allowDeadSilence && (m.deadSilence > CHOPPED_ZERO || m.gateSwitches > OVER_SWITCH_WARN)
const chopped = (m: Measured): boolean => m.wordLossDb > CHOP_OK_DB

/**
 * Before the level: the chain as it is cuts the voice (words lost, dead silence, or no voice at all) and a ReaFIR is
 * on → ReaFIR off, kept when the damage really went away. A noise profile that does not fit the take subtracts the
 * voice with the room; no value of the other effects brings those words back.
 */
export async function repairSwitches(s: Session): Promise<void> {
  const m = s.m
  if (!m.silent && !chopped(m) && !dead(s, m)) return
  const repaired = (b: Measured, a: Measured): string | null => {
    if (a.silent) return 'the voice still does not come out'
    if (b.silent) return null
    return a.deadSilence <= b.deadSilence - DEAD_MIN_GAIN || a.gateSwitches < b.gateSwitches || a.wordLossDb <= b.wordLossDb - CHOP_MIN_GAIN_DB ? null : 'the voice is cut as much as before'
  }
  for (const fir of s.live('reafir')) {
    const metric = m.silent ? 'speechDb' : chopped(m) ? 'wordLossDb' : 'deadSilence'
    const r = await s.tryMoves('baseline', [switchMove(fir, false, { reason: 'deadSilence', titleMsg: reasonMsg('switch.reafirDamage'), metric })], 'damage', repaired)
    if (r !== 'reverted') return
  }
}

/** Strengths a Noise Removal that was off is tried at, lightest first, inside the amount's cap (targets.ts nrLadder). */
const strengths = (s: Session): number[] => nrLadder(s.targets.caps)

/**
 * The voice over the pauses misses the target by NR_ON_MIN_MISS_DB, nothing is damaged, no Noise Removal is on and
 * one sits in the chain switched off → Noise Removal on, at the strength that scores best: each strength is one
 * render, lightest first, up to the first that reaches the target; of those that win NOISE_MIN_GAIN_DB and pass the
 * keep rule, the best total is kept (the lighter on a tie). Pauses a remover turns fully silent are not damage while
 * no word is cut (the targets allow dead silence from here on; the result says so, unmet.silentPauses): Elgato Noise
 * Removal does that from a strength of about 5, where it also takes the room 25 dB further down than at 0. A remover
 * that costs the voice is not kept, and one that removed the room at some strength and was rejected at all of them is
 * not asked again.
 */
export async function noiseRemovalOn(s: Session): Promise<void> {
  const strict = s.targets
  if (s.m.silent || dead(s, s.m) || chopped(s.m) || !(s.m.snrDb < strict.snrDb - NR_ON_MIN_MISS_DB)) return
  if (s.refused.has(NR_ON) || s.live('noiseRemoval', 'strength').length) return
  const nr = s.off('noiseRemoval', 'strength').at(0)
  if (!nr) return
  const t = strict.allowDeadSilence ? strict : { ...strict, allowDeadSilence: true }
  const before = scoreOf(s.m, t, s.trim())
  let best: { set: Kept['set']; audio: Float32Array; m: Measured; total: number; strength: number } | null = null
  let harmed = false
  for (const strength of strengths(s)) {
    const set = s.withMoves('noise', [
      switchMove(nr, true, { reason: 'noisyPause', titleMsg: reasonMsg('switch.nrOn', { snr: s.m.snrDb }), metric: 'snrDb' }),
      { slot: nr, key: 'strength', to: strength, reason: 'noisyPause', titleMsg: reasonMsg('noise.onStrength', { to: strength }), metric: 'snrDb' },
    ])
    if (!set) continue
    if (s.left('noise') < 1) {
      s.outOfBudget = true
      break
    }
    const { audio, m } = await s.render('noise', set)
    s.cut(set, audio, m, s.m)
    const after = scoreOf(m, t, s.trim(set))
    const removed = m.snrDb >= s.m.snrDb + NOISE_MIN_GAIN_DB
    const why = !removed ? 'not enough' : chopped(m) ? 'it cuts quiet words' : worseBecause(before, after, 'noise')
    s.note('noise', why ? 'revert' : 'render', `#${s.renders} noiseRemoval[${nr.index}] on at strength ${strength}: voice over pauses ${s.m.snrDb.toFixed(1)} → ${m.snrDb.toFixed(1)} dB, dead silence ${(100 * m.deadSilence).toFixed(1)} %, word loss ${m.wordLossDb.toFixed(1)} dB${why ? `: ${why}` : ''}`, after)
    if (why) {
      harmed ||= removed
      // quiet words cut: a stronger setting only cuts more
      if (chopped(m)) break
      continue
    }
    if (!best || after.total < best.total - 1e-9) best = { set, audio, m, total: after.total, strength }
    if (m.snrDb >= t.snrDb) break
  }
  if (!best) {
    if (harmed) s.refused.add(NR_ON)
    return
  }
  s.note('noise', 'keep', `noiseRemoval[${nr.index}] on at strength ${best.strength}: score ${before.total.toFixed(1)} → ${best.total.toFixed(1)}`)
  s.silentByRemover = t !== strict
  s.targets = t
  s.set = best.set
  s.audio = best.audio
  s.m = best.m
}

/**
 * After a tone fix (or a compressor) changed what the gates receive, the room: the gates placed again when the voice over the pauses fell under
 * the use's own target (regate), and a switched-off Noise Removal on when it misses what the goals ask for
 * (noiseRemovalOn). Each by its own keep rule.
 */
export async function roomTouchUp(s: Session): Promise<void> {
  await regate(s)
  await noiseRemovalOn(s)
}

/**
 * ReaFIR off on top of the kept state, without the keep rule (the branch below judges it): one render, and when a
 * working gate behind a compressor opened on the pauses for it (GATE_OPENED_DB of voice over the pauses lost), the
 * gate's threshold placed again for what it now receives (replaceGates: a probe and one more render). False when the
 * budget does not allow it or the voice came out damaged; the kept state is untouched then.
 */
async function firOff(s: Session, fir: ChainSlot, band: number): Promise<boolean> {
  const off = switchMove(fir, false, { reason: 'tone', titleMsg: reasonMsg('switch.reafirTone', bandRange(band)), metric: 'tone', band })
  const before = s.m
  const fits = (m: Measured): boolean => !m.silent && scoreOf(m, s.targets).damage <= scoreOf(before, s.targets).damage + REGRESS_TOL
  let set = s.withMoves('noise', [off])
  if (!set || s.left('noise') < 1) return false
  let r = await s.render('noise', set)
  const ofBand = (m: Measured): string => bandsOfCells(m.cells).map((v, b) => `${BAND_KEYS[b]} ${(v - bandsOfCells(before.cells)[b]).toFixed(1)}`).join(', ')
  s.note('noise', 'render', `#${s.renders} reafir[${fir.index}] off: speech ${before.speechDb.toFixed(1)} → ${r.m.speechDb.toFixed(1)} dBFS, voice over pauses ${before.snrDb.toFixed(1)} → ${r.m.snrDb.toFixed(1)} dB, word loss ${before.wordLossDb.toFixed(1)} → ${r.m.wordLossDb.toFixed(1)} dB; each band of the voice without it, dB: ${ofBand(r.m)}`, scoreOf(r.m, s.targets, s.trim(set)))
  if (r.m.snrDb < before.snrDb - GATE_OPENED_DB) {
    const extra = await replaceGates(s, 'noise', [off], fir.index)
    const again = extra && s.withMoves('noise', [off, ...extra])
    if (again && s.left('noise') >= 1) {
      set = again
      r = await s.render('noise', set)
      s.note('noise', 'render', `#${s.renders} reafir[${fir.index}] off with the gate placed again: voice over pauses ${r.m.snrDb.toFixed(1)} dB`, scoreOf(r.m, s.targets, s.trim(set)))
    }
  }
  if (!fits(r.m)) {
    s.note('noise', 'revert', `reafir[${fir.index}] off: the voice came out damaged`)
    return false
  }
  // what its gate cuts is not measured yet (protectWords does that before the branch is judged)
  r.m.cutShare = NaN
  r.m.cutEvents = NaN
  s.set = set
  s.audio = r.audio
  s.m = r.m
  return true
}

/**
 * A render without what its gate cuts: the branches are compared before the final gate is made gentle (tune():
 * protectWords), which brings either of them to no cut words, so what a gate placed in passing happens to cut in one
 * of them does not decide between them.
 */
const uncut = (m: Measured): Measured => ({ ...m, cutShare: NaN, cutEvents: NaN })

/**
 * The tone stage, and the question a ReaFIR raises: is the tone better reached with it or without it?
 * 1. Tone with the chain as kept (toneStage). No ReaFIR on, or the tone it reached scores under FIR_OFF_MIN_TONE →
 *    done.
 * 2. Otherwise the other branch, from the state before the tone stage: ReaFIR off (firOff), Noise Removal on in its
 *    place when the room then misses its target (noiseRemovalOn, its own keep rule), and the tone stage again on what
 *    the voice measures without it.
 * 3. The branch replaces the first result only when its measured score beats it by the keep rule (total down by
 *    MIN_GAIN, the room and the rest not worse beyond what the tone won); otherwise everything goes back to the first
 *    result. Both ends were rendered: nothing is kept on a prediction.
 * Each branch ends with the noise stage's second go (roomTouchUp) before it is judged, and both are judged like the
 * tone stage's own plans (toneJudge: the room may give way down to the use's own target).
 */
export async function toneWithSwitch(s: Session): Promise<ToneNotes> {
  const t = toneJudge(s.targets)
  const start = s.snapshot()
  const notes = await toneStage(s)
  await roomTouchUp(s)
  const fir = s.live('reafir').at(0)
  const with_ = scoreOf(uncut(s.m), t, s.trim())
  if (!fir || s.m.silent || !(with_.tone >= FIR_OFF_MIN_TONE)) return notes
  const kept = s.snapshot()
  const excess = toneExcess(toneOf(start.m, t), t).map((e, b) => e * t.weight[b])
  s.restore(start)
  s.note('noise', 'info', `the tone still scores ${with_.tone.toFixed(1)} with ReaFIR on: trying the chain without it`)
  if (!(await firOff(s, fir, excess.indexOf(Math.max(...excess))))) {
    s.restore(kept)
    return notes
  }
  await noiseRemovalOn(s)
  const notesOff = await toneStage(s)
  await roomTouchUp(s)
  const without = scoreOf(uncut(s.m), t, s.trim())
  const why = worseBecause(with_, without, 'tone')
  if (why) {
    s.note('noise', 'revert', `reafir[${fir.index}] off, with the tone tuned for it: ${why} (score ${with_.total.toFixed(1)} with it, ${without.total.toFixed(1)} without)`, without)
    s.restore(kept)
    return notes
  }
  s.note('noise', 'keep', `reafir[${fir.index}] off, with the tone tuned for it: score ${with_.total.toFixed(1)} → ${without.total.toFixed(1)}`, without)
  return notesOff
}
