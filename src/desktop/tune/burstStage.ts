// The words and the pauses under Noise Removal (SPEC "Tune from a recording (desktop)" → Bursts in the pauses): the
// last stage. Elgato Noise Removal is a gate on a voice detector, and it reacts to the level it receives:
// - it can take the soft starts and ends of words with the room, which the gates' cut measure cannot see (that one
//   compares with the same chain with only its gates passing everything, Noise Removal still on);
// - when the room it receives sits near its threshold it lets the room through for a moment, in the middle of a pause
//   or right after a word, and against its digital silence that moment is what is heard. On the real chain a
//   strength from 10 to 80 changed nothing there; what did is the ReaGate before it closing in the pauses, so that it
//   receives less room.
// Both are judged on the final state, against one render of the chain without Noise Removal and with its gates
// passing everything.
import { GATE_MIN_DB, GATE_OFF_WET_DB, gateIsOff, openGainDb } from '../../plain/refine'
import type { ChainSlot } from '../advice/types'
import { cutOf, fineLevels, type Measured } from './measure'
import { reasonMsg } from './msgs'
import { PEAK_TOL_DB } from './peakStage'
import { CHOP_OK_DB, cutsSpeech, heardSnrDb, LEVEL_TOL_DB, REGRESS_TOL, scoreOf, SCORE_PARTS, worseBecause } from './score'
import { switchMove, type Move, type Pending, type Session } from './session'
import { GATE_DRY_STEPS, GATE_SAFE_DB, nrBase } from './stages'

/** The gate before Noise Removal is tried this far under the pause peaks it receives, dB (it may open on the loudest of them). */
export const BURST_GATE_UNDER_DB: readonly number[] = [2, 1]
/** A move must bring the loudest burst this much further under the voice, dB… */
export const BURST_MIN_GAIN_DB = 1
/** …or leave at most this share of the bursts, with the loudest no closer to the voice than BURST_SAME_DB. */
export const BURST_FEWER_SHARE = 0.75
export const BURST_SAME_DB = 0.5

const r05 = (v: number): number => Math.round(v * 2) / 2 || 0
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Whether a render's pauses carry bursts that cost noise points (the loudest under the voice-over-room target). */
export const burstsCost = (m: Pick<Measured, 'burstDb' | 'snrDb' | 'silent'>, snrTargetDb: number): boolean =>
  !m.silent && Number.isFinite(m.burstDb) && heardSnrDb(m) < snrTargetDb

/** What Noise Removal and the gates cut of the words of a render, against the chain without them. */
type Words = (audio: Float32Array) => { share: number; events: number }

/** Marks a render with what Noise Removal and the gates cut of its words (Measured.removerCut / removerCutEvents). */
function mark(m: Measured, c: { share: number; events: number }): Measured {
  m.removerCut = c.share
  m.removerCutEvents = c.events
  return m
}

/**
 * When Noise Removal is on, one render first: the chain without it and with its gates passing everything — the
 * reference the words are measured against (what Noise Removal and the gates cut together, cutOf) and what a gate
 * before it receives. Then:
 * 1. Words first: while that cuts words (cutsSpeech), Noise Removal lighter — half a step, a step, then as light as the
 *    amount allows — one render each; the first that no longer cuts is kept, else the one that cuts least (whatever it
 *    costs the room: no quiet pause is worth cut words).
 * 2. While the pauses carry bursts that cost noise points, in this order, one render each:
 *    a. the last ReaGate before Noise Removal closes in the pauses: Dry −12 (or the deeper one it has), Threshold
 *       BURST_GATE_UNDER_DB under the pause peaks it receives (never closer than GATE_SAFE_DB to the quiet syllables'
 *       peaks), its Hold and Release as they are (on the real chain 200 / 300 ms and 300 / 400 ms measured the same),
 *       and the make-up Wet up by what its open gain gave the voice (a doubled gate gave 6 dB), so the level stays;
 *    b. Noise Removal one step stronger, half a step when that cut words, inside the amount's cap.
 *    A candidate is kept when no word is cut more than before (cut events against the reference and, for a gate move,
 *    against the chain with its gates passing — the result's own cut measure, rendered once for it), the peak stays
 *    under the ceiling, the level stays on target, no quiet words are lost, and the bursts got quieter
 *    (BURST_MIN_GAIN_DB, judged by the keep rule on the noise part) or fewer (BURST_FEWER_SHARE, the loudest no closer
 *    and no part of the score worse).
 */
export async function burstStage(s: Session): Promise<void> {
  const nr = s.live('noiseRemoval', 'strength').at(0)
  // the words are checked when this run moved Noise Removal (switched it on, changed its strength), the bursts whenever
  // they cost: a chain left as it was costs no render
  const moved = [...s.set.values()].some((p) => p.slot.index === nr?.index)
  if (!nr || s.m.silent || !(moved || burstsCost(s.m, s.targets.snrDb))) return
  if (s.left('trim') < 1) {
    s.outOfBudget = true
    return
  }
  const title = reasonMsg('bursts.gate')
  const passing: Move[] = s.live('reagate', 'wetDb', 'dryDb').flatMap((g): Move[] => [
    { slot: g, key: 'wetDb', to: GATE_OFF_WET_DB, reason: 'noisyPause', titleMsg: title, metric: 'burstDb' },
    { slot: g, key: 'dryDb', to: 0, reason: 'noisyPause', titleMsg: title, metric: 'burstDb' },
  ])
  const refSet = s.withMoves('trim', [switchMove(nr, false, { reason: 'noisyPause', titleMsg: title, metric: 'burstDb' }), ...passing])
  if (!refSet) return
  const kept = s.last
  const ref = await s.render('trim', refSet)
  s.last = kept
  const open = fineLevels(ref.audio, s.mask.sampleRate)
  const words: Words = (audio) => cutOf(s.mask, audio, open)
  mark(s.m, words(s.audio))
  s.note('trim', 'render', `#${s.renders} the chain without Noise Removal and with its gates passing everything: what the words are measured against (now ${(100 * s.m.removerCut).toFixed(1)} % cut, ${s.m.removerCutEvents.toFixed(1)} per 10 s); pause peaks ${ref.m.pausePeakDb.toFixed(1)}, quiet syllables ${ref.m.quietPeakDb.toFixed(1)} dBFS`)

  await wordsFirst(s, nr, words)
  if (burstsCost(s.m, s.targets.snrDb)) {
    const attempt = burstAttempt(s, words)
    const gate = s.live('reagate', 'thresholdDb', 'wetDb', 'dryDb').filter((g) => g.index < nr.index).at(-1)
    if (gate && s.gain && s.gain.slot.index < gate.index && Number.isFinite(ref.m.pausePeakDb)) await gateBefore(s, gate, ref.m, attempt)
    if (burstsCost(s.m, s.targets.snrDb)) await stronger(s, nr, attempt)
  }
  // what a working gate cuts, as the result measures it, after a Noise Removal move changed what follows it
  if (s.gatesWorking().length) await s.checkCut('trim')
}

/** Takes a candidate's set and render as the kept state. */
function keep(s: Session, set: Map<string, Pending>, audio: Float32Array, m: Measured): void {
  s.set = set
  s.audio = audio
  s.m = m
}

/** Step 1: Noise Removal lighter while it cuts words, the first that no longer does, else the one that cuts least. */
async function wordsFirst(s: Session, nr: ChainSlot, words: Words): Promise<void> {
  if (!cutsSpeech({ cutShare: s.m.removerCut, cutEvents: s.m.removerCutEvents })) return
  const caps = s.targets.caps
  const from = s.value(nr, 'strength')
  const floor = Math.max(0, nrBase(nr) - caps.nrMax)
  const tries = [...new Set([from - caps.nrStep / 2, from - caps.nrStep, floor].map((v) => Math.max(floor, Math.round(v))))].filter((v) => v < from).sort((a, b) => b - a)
  let best: { set: Map<string, Pending>; audio: Float32Array; m: Measured } | null = null
  for (const to of tries) {
    const set = s.withMoves('trim', [{ slot: nr, key: 'strength', to, reason: 'deadSilence', titleMsg: reasonMsg('words.strength', { to }), metric: 'removerCut' }])
    if (!set) continue
    if (s.left('trim') < 1) {
      s.outOfBudget = true
      break
    }
    const b = s.m
    const { audio, m } = await s.render('trim', set)
    s.cut(set, audio, m, b)
    mark(m, words(audio))
    const ok = !m.silent && m.peakDb <= Math.max(s.targets.peakCeilDb + PEAK_TOL_DB, b.peakDb)
    s.note('trim', 'render', `#${s.renders} noiseRemoval[${nr.index}] strength ${from} → ${to} for the words: cut ${(100 * b.removerCut).toFixed(1)} → ${(100 * m.removerCut).toFixed(1)} %, ${b.removerCutEvents.toFixed(1)} → ${m.removerCutEvents.toFixed(1)} per 10 s${ok ? '' : ': the peak went over'}`, scoreOf(m, s.targets, s.trim(set)))
    if (!ok) continue
    if (!best || m.removerCut < best.m.removerCut) best = { set, audio, m }
    if (!cutsSpeech({ cutShare: m.removerCut, cutEvents: m.removerCutEvents })) break
  }
  if (!best || !(best.m.removerCut < s.m.removerCut)) {
    s.note('trim', 'info', 'no lighter Noise Removal cut fewer words')
    return
  }
  // a lighter remover leaves more room for a working gate after it: what that gate now cuts or pumps is measured too
  const was = s.snapshot()
  const damage = scoreOf(s.m, s.targets, s.trim()).damage
  keep(s, best.set, best.audio, best.m)
  if (s.gatesWorking().length) await s.checkCut('trim')
  const now = scoreOf(s.m, s.targets, s.trim()).damage
  if (now > damage + REGRESS_TOL) {
    s.note('trim', 'revert', `Noise Removal lighter for the words: the gate after it would cut or pump (damage ${damage.toFixed(1)} → ${now.toFixed(1)})`)
    s.restore(was)
    return
  }
  s.note('trim', 'keep', `Noise Removal lighter for the words: cut ${(100 * was.m.removerCut).toFixed(1)} → ${(100 * best.m.removerCut).toFixed(1)} %`)
}

type Attempt = (moves: Move[], what: string) => Promise<'kept' | 'cut' | 'no'>

/** One burst candidate: rendered, kept when it removes bursts and costs the words, the level and the peak nothing. */
function burstAttempt(s: Session, words: Words): Attempt {
  const t = s.targets
  return async (moves, what) => {
    const set = s.withMoves('trim', moves)
    if (!set) return 'no'
    if (s.left('trim') < 1) {
      s.outOfBudget = true
      return 'no'
    }
    const b = s.m
    // a gate move: what it cuts is also measured as the result measures it (the chain with its gates passing)
    const gated = s.gatesWorking(set).length > 0 && moves.some((mv) => mv.slot.kind === 'reagate')
    if (gated && s.left('trim') >= 2) await s.openRef('trim', set)
    const { audio, m } = await s.render('trim', set)
    s.cut(set, audio, m, b)
    mark(m, words(audio))
    const own = gated && Number.isFinite(m.cutEvents) && (m.cutEvents > (Number.isFinite(b.cutEvents) ? b.cutEvents : 0) + 1e-9 || (cutsSpeech(m) && !cutsSpeech(b)))
    const before = scoreOf(b, t, s.trim())
    const after = scoreOf(m, t, s.trim(set))
    const quieter = !Number.isFinite(m.burstDb) || heardSnrDb(m) >= heardSnrDb(b) + BURST_MIN_GAIN_DB
    const fewer = heardSnrDb(m) >= heardSnrDb(b) - BURST_SAME_DB && m.burstEvents <= BURST_FEWER_SHARE * b.burstEvents
    const cut = own || m.removerCutEvents > b.removerCutEvents + 1e-9 || (cutsSpeech({ cutShare: m.removerCut, cutEvents: m.removerCutEvents }) && m.removerCut > b.removerCut)
    const why = cut
      ? `cuts words (${(100 * b.removerCut).toFixed(1)} → ${(100 * m.removerCut).toFixed(1)} %, ${b.removerCutEvents.toFixed(1)} → ${m.removerCutEvents.toFixed(1)} per 10 s; against the chain with its gates passing ${(100 * m.cutShare).toFixed(1)} %, ${m.cutEvents.toFixed(1)} per 10 s)`
      : m.peakDb > Math.max(t.peakCeilDb + PEAK_TOL_DB, b.peakDb)
        ? `peak ${m.peakDb.toFixed(1)} dBFS`
        : Math.abs(m.speechDb - t.speechDb) > Math.max(LEVEL_TOL_DB, Math.abs(b.speechDb - t.speechDb) + 0.5)
          ? `voice level ${m.speechDb.toFixed(1)} dBFS`
          : m.wordLossDb > Math.max(CHOP_OK_DB, b.wordLossDb + 0.5)
            ? `quiet words lost ${m.wordLossDb.toFixed(1)} dB`
            : quieter
              ? worseBecause(before, after, 'noise')
              : fewer
                ? (SCORE_PARTS.filter((p) => after[p] > before[p] + REGRESS_TOL).map((p) => `${p} got worse`)[0] ?? null)
                : 'no fewer or quieter bursts'
    const said = (x: Measured): string => (Number.isFinite(x.burstDb) ? `${x.burstDb.toFixed(1)} dB under the voice, ${x.burstEvents.toFixed(1)} per 10 s` : 'none')
    s.note('trim', why ? 'revert' : 'keep', `#${s.renders} ${what}: bursts ${said(b)} → ${said(m)}; words cut ${(100 * m.removerCut).toFixed(1)} %, ${m.removerCutEvents.toFixed(1)} per 10 s${why ? `: ${why}` : ''}`, after)
    if (why) return cut ? 'cut' : 'no'
    keep(s, set, audio, m)
    return 'kept'
  }
}

/** Step 2a: the gate before Noise Removal closes in the pauses, the make-up Wet gives the voice back its open gain. */
async function gateBefore(s: Session, g: ChainSlot, ref: Measured, attempt: Attempt): Promise<void> {
  const gain = s.gain
  if (!gain) return
  const cur = { wet: s.value(g, 'wetDb'), dry: s.value(g, 'dryDb') }
  const next = { wet: gateIsOff(cur) ? 0 : cur.wet, dry: Math.min(cur.dry, GATE_DRY_STEPS[1]) }
  const wet = s.value(gain.slot, 'wetDb')
  const wetTo = r05(clamp(wet + openGainDb(cur) - openGainDb(next), gain.lo, gain.hi))
  const moved = wetTo - wet
  // what the gate receives with the new Wet: the reference's pauses and quiet syllables, moved by it
  const pause = ref.pausePeakDb + moved
  const quiet = ref.quietPeakDb + moved
  const title = reasonMsg('bursts.gate')
  for (const under of BURST_GATE_UNDER_DB) {
    const threshold = r05(pause - under)
    if (threshold < GATE_MIN_DB || (Number.isFinite(quiet) && threshold > quiet - GATE_SAFE_DB)) continue
    const moves: Move[] = [
      { slot: g, key: 'thresholdDb', to: threshold, reason: 'noisyPause', titleMsg: title, metric: 'burstDb' },
      { slot: g, key: 'dryDb', to: next.dry, reason: 'noisyPause', titleMsg: title, metric: 'burstDb' },
      { slot: g, key: 'wetDb', to: next.wet, reason: 'noisyPause', titleMsg: title, metric: 'burstDb' },
      { slot: gain.slot, key: 'wetDb', to: wetTo, reason: 'tooQuiet', titleMsg: reasonMsg('bursts.level', { db: Math.abs(moved) }), metric: 'speechDb' },
    ]
    const r = await attempt(moves, `reagate[${g.index}] threshold ${threshold}, Dry ${next.dry}, make-up Wet ${wet} → ${wetTo}`)
    if (r === 'kept' || r === 'cut') return
  }
}

/** Step 2b: Noise Removal one step stronger, half a step when that cut words, inside the amount's cap. */
async function stronger(s: Session, nr: ChainSlot, attempt: Attempt): Promise<void> {
  const caps = s.targets.caps
  let step = caps.nrStep
  for (let pass = 0; pass < 2 && step >= 5 && burstsCost(s.m, s.targets.snrDb); pass++) {
    const from = s.value(nr, 'strength')
    const to = Math.min(100, caps.nrCeil, nrBase(nr) + caps.nrMax, from + step)
    if (!(to > from)) return
    const r = await attempt([{ slot: nr, key: 'strength', to, reason: 'noisyPause', titleMsg: reasonMsg('bursts.strength', { to }), metric: 'burstDb' }], `noiseRemoval[${nr.index}] strength ${from} → ${to}`)
    // a step that cut words is tried at half; one that did not help, not again
    if (r !== 'cut') return
    step = Math.round(step / 2)
  }
}
