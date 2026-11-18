// What some complaints ask of the chain beyond targets and weights (SPEC "Tune from a recording (desktop)" → What the
// goals mean): a mains hum cut by a free ReaEQ band ("low hum or rumble"), less of the top when the room rules there
// ("high hiss"), and a gate that does nothing for the pauses switched to passing ("words cut off"). Each candidate is
// one render, kept only when it measurably did its job and cost nothing else.
import { eqBands, eqKey } from '../advice/chain'
import type { ChainSlot } from '../advice/types'
import { GATE_OFF_WET_DB, gatePassesAll, openGainDb } from '../../plain/refine'
import { guideRange, SHAPE_BW } from './eqModel'
import { humDb, HUM_OVER_DB, topDb, type Measured } from './measure'
import { reasonMsg } from './msgs'
import { LEVEL_TOL_DB, REGRESS_TOL, scoreOf, type ScorePart } from './score'
import type { Move, Session } from './session'
import type { TuneStage } from './types'

/** A hum cut must take this much off the hum's peak in the pauses, dB. */
export const HUM_MIN_GAIN_DB = 3
/** The hum cut: as deep as one and a half EQ steps of the amount, never deeper than the guide allows (−6 dB for a low band). */
export const HUM_CUT_STEPS = 1.5
/** "High hiss": the room rules the top when the speech is less than this over the pauses there, dB; a cut must take this much off the pauses' top, dB. */
export const HISS_ROOM_DB = 6
export const HISS_MIN_GAIN_DB = 2
/** "Words cut off": a gate goes to passing everything when Noise Removal holds the pauses at or under this, dBFS. */
export const GATE_OFF_PAUSES_DB = -65

/** Session.refused markers: the result says what was missing. */
export const HUM_NO_BAND = 'hum: no free band'
export const HISS_NO_SHELF = 'hiss: no high shelf'

/**
 * One candidate on the kept state: rendered, kept when `done` says it did its job, no part in `guard` got worse by more
 * than REGRESS_TOL (damage always guarded) and the level stayed on target.
 */
async function attempt(s: Session, stage: TuneStage, moves: Move[], what: string, done: (b: Measured, a: Measured, audio: Float32Array) => string | null, guard: readonly ScorePart[] = ['tone']): Promise<boolean> {
  const set = s.withMoves(stage, moves)
  if (!set) return false
  if (s.left(stage) < 1) {
    s.outOfBudget = true
    return false
  }
  const b = s.m
  const { audio, m } = await s.render(stage, set)
  s.cut(set, audio, m, b)
  const before = scoreOf(b, s.targets, s.trim())
  const after = scoreOf(m, s.targets, s.trim(set))
  const worse = (['damage', ...guard] as const).find((p) => after[p] > before[p] + REGRESS_TOL)
  const level = Math.abs(m.speechDb - s.targets.speechDb) > Math.max(LEVEL_TOL_DB, Math.abs(b.speechDb - s.targets.speechDb) + 0.5)
  const why = m.silent ? 'the voice is gone' : (done(b, m, audio) ?? (worse ? `${worse} got worse (${before[worse].toFixed(1)} → ${after[worse].toFixed(1)})` : level ? `voice level ${m.speechDb.toFixed(1)} dBFS` : null))
  s.note(stage, why ? 'revert' : 'keep', `#${s.renders} ${what}${why ? `: ${why}` : ''}`, after)
  if (why) return false
  s.set = set
  s.audio = audio
  s.m = m
  return true
}

/** A ReaEQ band nobody uses: on, a peak band (not a shelf, not a notch), at 0 dB and not moved in this run. */
function freeBand(s: Session): { slot: ChainSlot; n: number } | null {
  for (const slot of s.live('reaeq')) {
    for (const b of eqBands(slot)) {
      if (!b.on || b.type !== 'Band' || !(b.bwOct >= SHAPE_BW[0]) || Math.abs(b.gainDb) > 0.5) continue
      if ((['gainDb', 'freqHz', 'bwOct'] as const).some((f) => s.set.has(`${slot.index}:${eqKey(b.n, f)}`))) continue
      return { slot, n: b.n }
    }
  }
  return null
}

/**
 * "Low hum or rumble" picked and the raw take's pauses show a mains hum (TakeMask.humHz): a free ReaEQ band goes onto
 * it, as narrow as the tuner sets a band (SHAPE_BW) and HUM_CUT_STEPS of the amount's EQ step deep (inside the guide's
 * range), kept when the hum in the pauses came down HUM_MIN_GAIN_DB and the tone did not get worse. No free band: the
 * result says where to put one (unmet.hum.noBand).
 */
export async function humStage(s: Session): Promise<void> {
  const hz = s.mask.humHz
  if (!s.targets.humCut || !Number.isFinite(hz) || s.m.silent) return
  const before = humDb(s.mask, s.audio)
  if (!(before >= HUM_OVER_DB)) return
  const band = freeBand(s)
  if (!band) {
    s.refused.add(HUM_NO_BAND)
    s.note('tone', 'info', `a ${hz} Hz hum stands ${before.toFixed(1)} dB over the room, and no ReaEQ band is free to cut it`)
    return
  }
  const gain = Math.max(guideRange('Band', hz)[0], -HUM_CUT_STEPS * s.targets.caps.eqStepDb)
  const title = reasonMsg('hum.cut', { hz, db: -gain })
  const moves: Move[] = [
    { slot: band.slot, key: eqKey(band.n, 'gainDb'), to: gain, reason: 'tone', titleMsg: title, metric: 'tone', band: 0 },
    { slot: band.slot, key: eqKey(band.n, 'freqHz'), to: hz, reason: 'tone', titleMsg: title, metric: 'tone', band: 0 },
    { slot: band.slot, key: eqKey(band.n, 'bwOct'), to: SHAPE_BW[0], reason: 'tone', titleMsg: title, metric: 'tone', band: 0 },
  ]
  const less = (_b: Measured, _a: Measured, audio: Float32Array): string | null => {
    const after = humDb(s.mask, audio)
    return after <= before - HUM_MIN_GAIN_DB ? null : `the hum stands ${before.toFixed(1)} → ${after.toFixed(1)} dB over the room: not enough`
  }
  await attempt(s, 'tone', moves, `reaeq[${band.slot.index}] band ${band.n} onto the ${hz} Hz hum, ${gain} dB`, less)
}

/**
 * "High hiss" picked and the room rules the top of the spectrum (the speech less than HISS_ROOM_DB over the pauses from
 * HISS_FROM_HZ up): the last high shelf of a switched-on ReaEQ comes down one EQ step (inside the guide's range), kept
 * when the pauses' top came down HISS_MIN_GAIN_DB with nothing damaged and the level on target (the voice's own top goes
 * down with it: that is the trade asked for). No high shelf: the result says so.
 */
export async function hissStage(s: Session): Promise<void> {
  if (!s.targets.hissCut || s.m.silent) return
  const top = topDb(s.mask, s.audio)
  if (!(top.speech - top.pause < HISS_ROOM_DB)) return
  const shelf = s
    .live('reaeq')
    .flatMap((slot) => eqBands(slot).filter((b) => b.on && b.type === 'High Shelf').map((b) => ({ slot, n: b.n, freqHz: b.freqHz })))
    .at(-1)
  if (!shelf) {
    s.refused.add(HISS_NO_SHELF)
    return
  }
  const key = eqKey(shelf.n, 'gainDb')
  const from = s.value(shelf.slot, key)
  const to = Math.max(guideRange('High Shelf', shelf.freqHz)[0], Math.round((from - s.targets.caps.eqStepDb) * 2) / 2)
  if (!(to < from)) return
  const move: Move = { slot: shelf.slot, key, to, reason: 'tone', titleMsg: reasonMsg('hiss.shelf', { db: from - to }), metric: 'tone', band: 8 }
  const less = (_b: Measured, _a: Measured, audio: Float32Array): string | null => {
    const after = topDb(s.mask, audio).pause
    return after <= top.pause - HISS_MIN_GAIN_DB ? null : `the hiss in the pauses ${top.pause.toFixed(1)} → ${after.toFixed(1)}: not enough`
  }
  // the top of the voice goes down with the hiss: that is what was asked, so only damage and the level are guarded
  await attempt(s, 'tone', [move], `reaeq[${shelf.slot.index}] high shelf ${from} → ${to} dB for the hiss`, less, [])
}

/**
 * "Words cut off" picked and Noise Removal holds the pauses at GATE_OFF_PAUSES_DB or under: a working gate has nothing
 * left to do for the room and can only cut words, so it passes everything (Wet off, Dry 0 dB) and, when it sits after
 * the make-up gain, the Wet gives the voice back the gate's open gain. Kept when the room as heard and nothing else got
 * worse.
 */
export async function gateOffForWords(s: Session, stage: TuneStage = 'trim'): Promise<void> {
  if (!s.targets.gentleGate || s.m.silent || !s.live('noiseRemoval', 'strength').length || !(s.m.pauseDb <= GATE_OFF_PAUSES_DB)) return
  for (const g of s.gatesWorking()) {
    const cur = { wet: s.value(g, 'wetDb'), dry: s.value(g, 'dryDb') }
    if (gatePassesAll(cur)) continue
    const title = reasonMsg('words.gateOff')
    const moves: Move[] = [
      { slot: g, key: 'wetDb', to: GATE_OFF_WET_DB, reason: 'deadSilence', titleMsg: title, metric: 'cutSpeech' },
      { slot: g, key: 'dryDb', to: 0, reason: 'deadSilence', titleMsg: title, metric: 'cutSpeech' },
    ]
    const gain = s.gain
    if (gain && gain.slot.index < g.index) {
      const wet = s.value(gain.slot, 'wetDb')
      const to = Math.min(gain.hi, Math.round((wet + openGainDb(cur)) * 2) / 2)
      if (to !== wet) moves.push({ slot: gain.slot, key: 'wetDb', to, reason: 'tooQuiet', titleMsg: reasonMsg('bursts.level', { db: Math.abs(to - wet) }), metric: 'speechDb' })
    }
    await attempt(s, stage, moves, `reagate[${g.index}] passing everything for the words`, () => null, ['noise', 'tone'])
  }
}
