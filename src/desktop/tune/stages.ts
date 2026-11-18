// The level, noise & gate, compression and final-trim stages. Each proposes a move from what the kept render
// measures, and Session.tryMoves keeps it only when the next render proves it (./session.ts).
import { OVER_SWITCH_WARN, PEAK_WARN_DB } from '../../audio/diagnose'
import { CHOPPED_ZERO, GATE_MIN_DB, GATE_OFF_WET_DB, GATE_SOFT_DRY_DB, GATE_STEP_DB, gateDoubles, gateIsOff, gatePassesAll, openGainDb } from '../../plain/refine'
import { sameValue } from '../advice/chain'
import type { ChainSlot } from '../advice/types'
import type { Measured } from './measure'
import { reasonMsg } from './msgs'
import { CHOP_OK_DB, cutsSpeech, LEVEL_TOL_DB, MIN_GAIN, pumps, scoreOf, toneOf, type ScorePart } from './score'
import { GATE_DEEPER, type Move, type Outcome, type Session } from './session'
import { GATE_GAP_SHARE_BASE, WORDS_CUT_RELEASE_MS, type TuneTargets } from './targets'
import type { TuneStage } from './types'

/** The final trim says so when it moved a tone band by more than this (a level-dependent effect after the gain), dB. */
export const TRIM_TONE_NOTE_DB = 2
/** A level move must bring the speech this much closer to the target, dB. */
export const LEVEL_MIN_GAIN_DB = 0.5
/** A noise move must win this much voice-over-pause SNR, dB (the doubled-gate fix: 1 dB). */
export const NOISE_MIN_GAIN_DB = 2
export const DOUBLED_MIN_GAIN_DB = 1
/** A move against dead silence must remove this share of zero samples; against cut words, this much word loss, dB. */
export const DEAD_MIN_GAIN = 0.02
export const CHOP_MIN_GAIN_DB = 1
/** A gate whose Dry is at or below this lets nothing through when closed: pauses become digital silence, dB. */
export const HARD_GATE_DRY_DB = -40
/** A compression move must narrow the level spread by this much, dB. */
export const SPREAD_MIN_GAIN_DB = 1
/** Compressor threshold: this far under the speech level it receives (suggest()), inside the guide's range, dB. */
export const COMP_UNDER_SPEECH_DB = 6
export const COMP_THRESHOLD_RANGE: readonly [number, number] = [-45, -12]
/** "Uneven volume" picked: bursts in the pauses this far under the voice (or further) do not hold a compression move back, dB. */
export const COMP_BURST_OK_DB = 25
/** Second compression pass: the threshold goes this much lower, dB. */
export const COMP_DEEPER_DB = 4

const r05 = (v: number): number => Math.round(v * 2) / 2 || 0
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Level (first stage) and final trim: the last gain stage's Wet moves the speech toward the target, never lifting
 * the peak over the ceiling; a peak already too close to clipping comes down. Kept when the level score as rendered
 * improves, the speech got LEVEL_MIN_GAIN_DB closer (or the peak came down) and no new sample clipped. When the
 * chain answered with less than the dB asked (a limiter, a later effect), a second pass corrects by the measured
 * slope. A working ReaGate after that gain stage moves its threshold by the same dB (followers). A render that lost
 * the voice altogether is not a level problem: nothing is tried.
 * The final trim (`trim`) is judged on the level, the peaks and the damage to the speech only: a Noise Removal after
 * the compressor reacts to level, and the tone or room it moves for that does not veto the trim (it is noted).
 */
export async function levelStage(s: Session, stage: 'level' | 'trim'): Promise<void> {
  const t = s.targets
  let slope = 1
  for (let pass = 0; pass < 2; pass++) {
    const m = s.m
    if (!s.gain || !Number.isFinite(m.speechDb) || m.silent) return
    const err = t.speechDb - m.speechDb
    const want = Math.min(err, t.peakCeilDb - m.peakDb)
    if (Math.abs(want) < LEVEL_TOL_DB && m.peakDb < PEAK_WARN_DB) return
    const wet = s.value(s.gain.slot, 'wetDb')
    const to = clamp(r05(wet + want / slope), s.gain.lo, s.gain.hi)
    if (sameValue(to, wet)) return
    const up = to > wet
    const forPeaks = !up && err >= 0
    const key = forPeaks ? 'level.peaks' : `${stage}.${up ? 'up' : 'down'}`
    const move: Move = {
      slot: s.gain.slot,
      key: 'wetDb',
      to,
      reason: up ? 'tooQuiet' : 'tooLoud',
      titleMsg: reasonMsg(key, { from: m.speechDb, target: t.speechDb, peak: m.peakDb, db: Math.abs(to - wet) }),
      metric: forPeaks ? 'peakDb' : 'speechDb',
    }
    const check = (b: Measured, a: Measured): string | null => {
      if (a.clipped > b.clipped) return `clipped ${a.clipped} samples`
      if (forPeaks) return a.peakDb < b.peakDb ? null : 'the peak did not come down'
      return Math.abs(t.speechDb - a.speechDb) <= Math.abs(t.speechDb - b.speechDb) - LEVEL_MIN_GAIN_DB ? null : 'the speech level did not get closer to the target'
    }
    // a gate after the make-up gain would open on louder pauses (or close on quieter words): its threshold moves along
    const follow: Move[] = followers(s).map((g) => ({
      slot: g,
      key: 'thresholdDb',
      to: r05(clamp(s.value(g, 'thresholdDb') + (to - wet), GATE_MIN_DB, 0)),
      reason: move.reason,
      titleMsg: reasonMsg('level.gateFollows', { db: Math.abs(to - wet) }),
      metric: 'speechDb',
    }))
    const tone = toneOf(m, t)
    if ((await s.tryMoves(stage, [move, ...follow], 'level', check, true, undefined, false, stage === 'trim')) !== 'kept') return
    // a remover after the compressor reacts to level: what the trim did to the tone is said, not weighed
    const moved = Math.max(0, ...toneOf(s.m, t).map((d, b) => (Number.isFinite(d) && Number.isFinite(tone[b]) && t.weight[b] > 0 ? Math.abs(d - tone[b]) : 0)))
    if (stage === 'trim' && moved > TRIM_TONE_NOTE_DB) s.trimToneDb = Math.max(s.trimToneDb, moved)
    const got = (s.m.speechDb - m.speechDb) / (to - wet)
    slope = got > 0.2 && got < 1.5 ? got : 1
  }
}

const gateOf = (s: Session, g: ChainSlot): { wet: number; dry: number } => ({ wet: s.value(g, 'wetDb'), dry: s.value(g, 'dryDb') })

/** Gate threshold the guide would set (suggest()): 30 dB under the speech behind a noise remover, else just over the room. */
export function gatePlanDb(speechDb: number, noiseDb: number, afterNoiseRemoval: boolean): number {
  return Math.round(afterNoiseRemoval ? clamp(speechDb - 30, GATE_MIN_DB, -45) : clamp(Math.max(Math.min(noiseDb + 12, speechDb - 25), noiseDb + 6), GATE_MIN_DB, -30))
}

/**
 * A gate's threshold sits this share of the way from the pause peaks (P90) up to the quiet syllables' peaks (P10) it
 * receives. Nearer the syllables than the pauses: its hold keeps it open through a phrase once a louder syllable opened
 * it, while every pause peak over the threshold holds it open for the hold time. On the real chain 40 % of the way
 * (−26 dB, 2 dB over the pause peaks) left the gate open on half the pauses after any +1.5 dB EQ move upstream, and
 * −20 dB still lost no word.
 */
export const GATE_GAP_SHARE = GATE_GAP_SHARE_BASE
/**
 * …but never closer than this under the quiet syllables' peaks: in a noisy room 70 % of a 3.6 dB gap put the threshold
 * 1 dB under them and the starts of words were cut (heard on the real chain; 3–4.5 cuts per 10 s). What is left of
 * that is protectWords' business. And never under
 * this much over the pause peaks, where it would not close at all, dB.
 */
export const GATE_SAFE_DB = 2
export const GATE_OVER_ROOM_DB = 0.5
/** A gentle gate: floors tried in turn when a deeper one cuts speech (Dry, dB), and the hold / release it gets with them, ms. */
export const GATE_DRY_STEPS: readonly number[] = [GATE_SOFT_DRY_DB, -12, -6]
export const GATE_HOLD_MS = 300
export const GATE_RELEASE_MS = 400
/** When the gate still cuts speech, its threshold comes down by this much at a time, dB. */
export const GATE_LOWER_DB = 3

/** What a gate receives, dBFS. */
export interface GateInput {
  /** Read from a render (behind a compressor), else the raw take's levels. */
  measured: boolean
  /** Median speech and room level. */
  speechDb: number
  noiseDb: number
  /**
   * Measured only: P90 of the pause peaks and P10 of the quiet syllables' peaks, what its detector sees. The pause
   * peaks are NaN when the render cannot show them: the gate closed on some pauses and opened on others there.
   */
  pausePeakDb: number
  quietPeakDb: number
}

/** A render that lost this much voice over the pauses had a gate open on them that closed before, dB. */
export const GATE_OPENED_DB = 6
/** A tone move that ended under the voice-over-room target having lost this much: the gate is placed again for it, dB. */
export const GATE_REPLACE_MIN_DB = 1
/** A room's sample peaks sit about this far over its RMS (real take: −41.4 dBFS RMS, peaks P50 −32), dB. */
export const ROOM_CREST_DB = 10
/** The gate values that pass everything at unity (Wet off, Dry 0 dB): a probe render shows what the gate receives. */
const PASS: { wet: number; dry: number } = { wet: GATE_OFF_WET_DB, dry: 0 }

/** A ReaComp before the gate and nothing after it that removes noise: what it receives can be read from a render. */
const readable = (s: Session, g: ChainSlot): boolean =>
  s.chain.some((c) => s.isOn(c) && c.kind === 'reacomp' && c.index < g.index) &&
  !s.chain.some((c) => s.isOn(c) && c.index > g.index && (c.kind === 'noiseRemoval' || c.kind === 'reafir' || c.kind === 'reagate'))

/**
 * What a gate receives. Without a compressor before it, the raw take's levels (a remover or an EQ before it barely
 * moves the speech). Behind a ReaComp (the noisy-room chain … → ReaComp → ReaGate) the raw levels say nothing: on the
 * real chain 18 dB of make-up sat before a gate whose −58 dB threshold opened on every pause. Then they come from a
 * render `m` made with the gate at `gate`, minus its open gain, when nothing after it removes noise (what follows it
 * is taken as unity). Its pauses read true only while it passes everything or never closes on them (threshold
 * ROOM_CREST_DB under their RMS): a gate opening on some pauses and closing on others mixes the two.
 */
export function gateInputDb(s: Session, g: ChainSlot, m: Measured = s.m, gate = gateOf(s, g)): GateInput {
  const a = s.mask.analysis
  if (!readable(s, g) || m.silent || !Number.isFinite(m.speechDb)) return { measured: false, speechDb: a.speechMed, noiseDb: a.noise, pausePeakDb: NaN, quietPeakDb: NaN }
  const open = openGainDb(gate)
  const clear = gatePassesAll(gate) || s.value(g, 'thresholdDb') < m.pauseDb - open - ROOM_CREST_DB
  return {
    measured: true,
    speechDb: m.speechDb - open,
    noiseDb: clear ? m.pauseDb - open : NaN,
    pausePeakDb: clear ? m.pausePeakDb - open : NaN,
    quietPeakDb: m.quietPeakDb - open,
  }
}

/** The gate opens on every pause it receives: its threshold sits under the pause peaks (or the room, raw levels). */
const neverCloses = (lv: GateInput, thresholdDb: number): boolean => (lv.measured ? thresholdDb < lv.pausePeakDb : thresholdDb <= lv.noiseDb)

/**
 * Where a gate's threshold should go for what it receives, NaN when nowhere helps (or nothing tells).
 * - Measured (behind a compressor): ReaGate opens on sample peaks (its RMS size at 0, as the guide leaves it), so the
 *   threshold goes GATE_GAP_SHARE of the way from the pause peaks to the quiet syllables' peaks, but stays GATE_SAFE_DB
 *   under those and at least GATE_OVER_ROOM_DB over the pause peaks (a room that close to the voice gets the gentlest
 *   place, and what the gate then cuts decides: the cut measure, protectWords). (Real chain: pause peaks −27.9, quiet syllables −22.7 → −24.5: voice over
 *   pauses 15 → about 33 dB, no word lost; the guide's room + 6 dB, −36, never closed.)
 * - Raw levels: the guide's threshold (gatePlanDb), 30 dB under the speech behind a noise remover.
 * The amount's cap counts from where the gate starts to act: a threshold under the room does nothing, so a move up
 * to the room is not processing yet.
 */
function gateTargetDb(s: Session, g: ChainSlot, lv: GateInput = gateInputDb(s, g)): number {
  const cap = s.targets.caps.gateDb
  if (lv.measured) {
    const gap = lv.quietPeakDb - lv.pausePeakDb
    if (!Number.isFinite(gap)) return NaN
    // "words cut off" picked: nearer the pauses (targets.gateGapShare)
    const place = Math.max(lv.pausePeakDb + GATE_OVER_ROOM_DB, Math.min(lv.pausePeakDb + s.targets.gateGapShare * gap, lv.quietPeakDb - GATE_SAFE_DB))
    return r05(clamp(Math.min(place, Math.max(g.values.thresholdDb, lv.pausePeakDb) + cap), GATE_MIN_DB, 0))
  }
  const removal = s.chain.some((c) => s.isOn(c) && (c.kind === 'noiseRemoval' || c.kind === 'reafir'))
  return r05(Math.min(gatePlanDb(lv.speechDb, lv.noiseDb, removal), Math.max(g.values.thresholdDb, lv.noiseDb) + cap))
}

/**
 * Higher thresholds for working gates (readable ones, not already moved) with `moves` applied, from one probe render
 * with those gates passing everything: what they receive cannot be read through a gate that closes on some pauses.
 * Null without such a gate, without two renders left (the probe and the candidate) or when no higher threshold helps.
 */
export async function replaceGates(s: Session, stage: TuneStage, moves: readonly Move[], after: number): Promise<Move[] | null> {
  const gates = s.live('reagate', 'thresholdDb', 'wetDb', 'dryDb').filter(
    (g) => g.index > after && readable(s, g) && !gatePassesAll(gateOf(s, g)) && !moves.some((mv) => mv.slot.index === g.index),
  )
  if (!gates.length || s.left(stage) < 2) return null
  const pass = gates.flatMap((g): Move[] => [
    { slot: g, key: 'wetDb', to: PASS.wet, reason: 'noisyPause', titleMsg: reasonMsg('noise.threshold', { to: 0 }), metric: 'snrDb' },
    { slot: g, key: 'dryDb', to: PASS.dry, reason: 'noisyPause', titleMsg: reasonMsg('noise.threshold', { to: 0 }), metric: 'snrDb' },
  ])
  const probe = s.withMoves(stage, [...moves, ...pass])
  if (!probe) return null
  const { m, audio } = await s.render(stage, probe)
  // the probe is the ungated chain: what the gates cut is measured against it
  s.keepRef(probe, audio)
  const out: Move[] = []
  for (const g of gates) {
    const lv = gateInputDb(s, g, m, PASS)
    const to = gateTargetDb(s, g, lv)
    s.note(stage, 'info', `gate ${g.index} receives pause peaks ${lv.pausePeakDb.toFixed(1)}, quiet syllables ${lv.quietPeakDb.toFixed(1)} dBFS: threshold ${to}`)
    if (Number.isFinite(to) && to > s.value(g, 'thresholdDb')) {
      out.push({ slot: g, key: 'thresholdDb', to, reason: 'noisyPause', titleMsg: reasonMsg('noise.threshold', { to }), metric: 'snrDb' })
    }
  }
  return out.length ? out : null
}

/**
 * Session.tryMoves for moves upstream of a working gate behind a compressor. When the candidate is rejected and its
 * render lost GATE_OPENED_DB of voice over the pauses (an EQ lift or a compressor raised what reaches the gate:
 * on the real chain a +3.5 dB high shelf put the room back at 15 dB under the voice), the gate's threshold is placed
 * again for what it receives with the moves (replaceGates: one probe render) and the moves are tried once more with
 * it. `judge` (the tone stage's targets): the candidate is scored against them, and one that was rejected and left
 * the voice over the pauses under their target (having lost GATE_REPLACE_MIN_DB of it) gets the same second go, with
 * the gate placed for what it receives, before it is given up.
 */
export async function tryWithGates(s: Session, stage: TuneStage, moves: readonly Move[], part: ScorePart, check?: (before: Measured, after: Measured) => string | null, judge?: TuneTargets): Promise<Outcome> {
  const renders = s.renders
  const r = await s.tryMoves(stage, moves, part, check, false, judge)
  if (r !== 'reverted' || s.renders === renders) return r
  const lost = s.m.snrDb - s.last.snrDb
  if (!(lost > GATE_OPENED_DB) && !(judge && lost >= GATE_REPLACE_MIN_DB && s.last.snrDb < judge.snrDb)) return r
  const mine = s.last
  const extra = await replaceGates(s, stage, moves, Math.min(...moves.map((mv) => mv.slot.index)))
  if (!extra) {
    // the latest render the caller reads is the candidate's own, not the probe with the gates passing everything
    s.last = mine
    return r
  }
  return s.tryMoves(stage, [...moves, ...extra], part, check, false, judge)
}

/** Working gates after the last gain stage: their threshold follows a Wet move, so they keep closing where they did. */
function followers(s: Session): ChainSlot[] {
  const gain = s.gain
  if (!gain) return []
  return s.live('reagate', 'thresholdDb', 'wetDb', 'dryDb').filter((g) => g.index > gain.slot.index && !gatePassesAll(gateOf(s, g)))
}

/**
 * Noise & gate, in this order, each move one render:
 * 1. Doubled ReaGate (Wet open, Dry above −10 dB: the voice passes twice and pauses are not reduced) → Dry −20, and
 *    when its threshold sits under the room it receives (it never closes), the threshold up to gateTargetDb with it.
 * 2. Damage first — dead digital silence (unless the goals allow it) or cut words (never allowed):
 *    a hard gate (Dry ≤ −40 dB) → Dry −20, pauses quiet instead of dead · Noise Removal one step lighter, then as
 *    light as the amount allows · the gate's Threshold GATE_STEP_DB lower (not under GATE_MIN_DB). The next candidate
 *    is tried when one does not help.
 * 3. Too little voice over the pauses and no damage → Noise Removal one step stronger (half a step when the full one
 *    damaged the voice), repeated while it helps · a gate that sits under the guide's threshold for the levels it
 *    receives (gateTargetDb) is raised to it.
 * A noise move is kept only when the SNR really rose NOISE_MIN_GAIN_DB and the damage score did not.
 */
export async function noiseStage(s: Session): Promise<void> {
  const t = s.targets
  const caps = t.caps
  const gates = s.live('reagate', 'thresholdDb', 'wetDb', 'dryDb')
  const nr = s.live('noiseRemoval', 'strength').at(0)

  for (const g of gates) {
    const gate = gateOf(s, g)
    if (!gateDoubles(gate)) continue
    // a gate opening on every pause it receives: Dry alone would change nothing but the level
    const from = s.value(g, 'thresholdDb')
    const to = gateTargetDb(s, g)
    const threshold: Move[] = neverCloses(gateInputDb(s, g), from) && to >= from + 1 ? [{ slot: g, key: 'thresholdDb', to, reason: 'noisyPause', titleMsg: reasonMsg('noise.threshold', { to }), metric: 'snrDb' }] : []
    // the deepest floor first; a shallower one (with a longer hold and release) only when the deeper one cut speech
    for (const dry of GATE_DRY_STEPS) {
      const moves: Move[] = [{ slot: g, key: 'dryDb', to: dry, reason: 'gateDoubled', titleMsg: reasonMsg('gateDoubled', { from: gate.dry, to: dry }), metric: 'snrDb' }, ...threshold, ...(dry > GATE_SOFT_DRY_DB ? longer(s, g) : [])]
      const renders = s.renders
      const r = await s.tryMoves('noise', moves, 'noise', snrUp(DOUBLED_MIN_GAIN_DB))
      if (r === 'budget') return
      // a shallower floor next when this one cut speech, or pumps an audible room (kept or not)
      if (s.renders === renders || !(cutsSpeech(s.last) || pumps(s.last))) break
    }
  }

  const dead = (m: Measured): boolean => !t.allowDeadSilence && (m.deadSilence > CHOPPED_ZERO || m.gateSwitches > OVER_SWITCH_WARN)
  const chopped = (m: Measured): boolean => m.wordLossDb > CHOP_OK_DB
  const repaired = (b: Measured, a: Measured): string | null =>
    a.deadSilence <= b.deadSilence - DEAD_MIN_GAIN || a.gateSwitches < b.gateSwitches || a.wordLossDb <= b.wordLossDb - CHOP_MIN_GAIN_DB ? null : 'the voice is cut as much as before'
  const failed = new Set<string>()
  for (let pass = 0; pass < 4 && (dead(s.m) || chopped(s.m)); pass++) {
    const metric = dead(s.m) ? 'deadSilence' : 'wordLossDb'
    const hard = dead(s.m) ? gates.find((g) => !gateIsOff(gateOf(s, g)) && gateOf(s, g).dry <= HARD_GATE_DRY_DB) : undefined
    const closing = gates.find((g) => !gatePassesAll(gateOf(s, g)) && s.value(g, 'thresholdDb') > Math.max(GATE_MIN_DB, g.values.thresholdDb - caps.gateDb))
    const strength = nr ? s.value(nr, 'strength') : 0
    // one step lighter; when that repaired nothing, as light as the amount allows (Elgato Noise Removal leaves digital
    // silence at any strength above about 10: on the real chain 44 → 24 changed nothing)
    const floor = nr ? Math.max(0, nrBase(nr) - caps.nrMax) : 0
    const lighter = [Math.max(floor, strength - caps.nrStep), floor].find((v) => v < strength && !failed.has(`strength:${v}`))
    let id: string
    let move: Move
    if (hard && !failed.has('dry')) {
      id = 'dry'
      move = { slot: hard, key: 'dryDb', to: GATE_SOFT_DRY_DB, reason: 'deadSilence', titleMsg: reasonMsg('dead.gateDry', { to: GATE_SOFT_DRY_DB }), metric }
    } else if (nr && lighter !== undefined) {
      id = `strength:${lighter}`
      move = { slot: nr, key: 'strength', to: lighter, reason: 'deadSilence', titleMsg: reasonMsg('dead.strength'), metric }
    } else if (closing && !failed.has('threshold')) {
      id = 'threshold'
      const from = s.value(closing, 'thresholdDb')
      const to = Math.max(GATE_MIN_DB, closing.values.thresholdDb - caps.gateDb, from - GATE_STEP_DB)
      move = { slot: closing, key: 'thresholdDb', to, reason: 'deadSilence', titleMsg: reasonMsg('dead.threshold', { db: from - to }), metric }
    } else break
    const r = await s.tryMoves('noise', [move], 'damage', repaired)
    if (r === 'budget') return
    if (r !== 'kept') failed.add(id)
  }
  // a render without a voice has no voice over the room to raise
  if (s.m.silent || dead(s.m) || chopped(s.m)) return

  if (nr && (await toCeiling(s, nr)) === 'budget') return
  if (nr && (await strengthen(s, nr)) === 'budget') return

  if (!(s.m.snrDb < t.snrDb)) return
  for (const g of gates) {
    if (gatePassesAll(gateOf(s, g))) continue
    const from = s.value(g, 'thresholdDb')
    const to = gateTargetDb(s, g)
    if (!(to >= from + 1)) continue
    const move: Move = { slot: g, key: 'thresholdDb', to, reason: 'noisyPause', titleMsg: reasonMsg('noise.threshold', { to }), metric: 'snrDb' }
    if ((await s.tryMoves('noise', [move], 'noise', snrUp(NOISE_MIN_GAIN_DB))) === 'budget') return
  }
}

/**
 * "Flat, no dynamics" picked and the spread is under targets.spreadMinDb: the last ReaComp lets go — half of its ratio
 * over 1:1 (not under FLAT_MIN_RATIO) and its threshold COMP_UNDER_SPEECH_DB higher (not over the range's top), one
 * render, then once more;
 * kept when the spread widened SPREAD_MIN_GAIN_DB and the score says so.
 */
async function letGo(s: Session): Promise<void> {
  const comp = s.live('reacomp', 'thresholdDb', 'ratio').at(-1)
  if (!comp) return
  const wider = (b: Measured, a: Measured): string | null => (a.spreadDb >= b.spreadDb + SPREAD_MIN_GAIN_DB ? null : `level spread ${b.spreadDb.toFixed(1)} → ${a.spreadDb.toFixed(1)} dB: not wider`)
  for (let pass = 0; pass < 2 && s.m.spreadDb < s.targets.spreadMinDb; pass++) {
    const ratio = Math.round(Math.max(FLAT_MIN_RATIO, 1 + (s.value(comp, 'ratio') - 1) / 2) * 10) / 10
    const threshold = Math.min(COMP_THRESHOLD_RANGE[1], s.value(comp, 'thresholdDb') + COMP_UNDER_SPEECH_DB)
    const moves: Move[] = [
      { slot: comp, key: 'ratio', to: ratio, reason: 'tooQuiet', titleMsg: reasonMsg('flat.ratio', { spread: s.m.spreadDb, to: ratio }), metric: 'spreadDb' },
      { slot: comp, key: 'thresholdDb', to: threshold, reason: 'tooQuiet', titleMsg: reasonMsg('flat.threshold', { spread: s.m.spreadDb, to: threshold }), metric: 'spreadDb' },
    ]
    if ((await tryWithGates(s, 'compression', moves, 'consistency', wider)) !== 'kept') return
  }
}

/** "Flat" picked: the compressor's ratio never goes under this when it lets go. */
export const FLAT_MIN_RATIO = 1.5

const snrUp = (min: number) => (b: Measured, a: Measured): string | null => (a.snrDb >= b.snrDb + min ? null : `voice over pauses ${b.snrDb.toFixed(1)} → ${a.snrDb.toFixed(1)} dB: not enough`)

/**
 * The noise stage's second go after a tone or compression move left the voice over the pauses under the use's own
 * target (targets.snrFloorDb): the working gates behind a compressor are placed again for what they receive now (one
 * probe render with them passing everything, replaceGates), and the higher threshold is kept when it wins
 * NOISE_MIN_GAIN_DB.
 */
export async function regate(s: Session): Promise<void> {
  if (s.m.silent || !(s.m.snrDb < s.targets.snrFloorDb)) return
  const kept = s.last
  const extra = await replaceGates(s, 'noise', [], -Infinity)
  s.last = kept
  if (extra) await s.tryMoves('noise', extra, 'noise', snrUp(NOISE_MIN_GAIN_DB))
}

/** A longer hold and release for a gate that has shorter ones (word tails stay open; "words cut off": a longer release). */
function longer(s: Session, g: ChainSlot): Move[] {
  const out: Move[] = []
  const release = s.targets.gentleGate ? WORDS_CUT_RELEASE_MS : GATE_RELEASE_MS
  for (const [key, to] of [['holdMs', GATE_HOLD_MS], ['releaseMs', release]] as const) {
    if (Number.isFinite(g.values[key]) && s.value(g, key) < to) out.push({ slot: g, key, to, reason: 'deadSilence', titleMsg: reasonMsg('words.times'), metric: 'cutSpeech' })
  }
  return out
}

/**
 * No cut words. The kept render's gate is measured against the ungated chain (Session.checkCut: one render when an
 * upstream move changed what the gate receives). With `repair`, while it cuts speech (more than CUT_OK_PCT of the
 * voice, or CUT_OK_EVENTS word starts / ends per 10 s), gentler versions of the last working gate are rendered, one
 * render each: its threshold a third, two thirds and all of GATE_LOWER_DB lower (in a noisy room the place that closes
 * on the pauses without cutting word starts is a dB wide), a shallower floor (Dry −12, Dry −6) and, in a second round,
 * a longer hold and release. Of those that no longer cut, the one with the best score is kept (the most voice over the room that leaves
 * the words whole); when none does, the one that cuts least, and one more round from there. What it costs in voice over
 * the room is not asked: no noise target, the use's own included, is worth cut words. The run remembers it
 * (GATE_DEEPER), so the result can say why the room is still there.
 */
export async function protectWords(s: Session, stage: TuneStage = 'noise', repair = true): Promise<void> {
  if (s.m.silent || !s.gatesWorking().length) return
  if (!(await s.checkCut(stage)) || !repair) return
  const t = s.targets
  for (let round = 0; round < 2 && (cutsSpeech(s.m) || pumps(s.m)); round++) {
    const g = s.gatesWorking().at(-1)
    if (!g) return
    s.refused.add(GATE_DEEPER)
    const threshold = s.value(g, 'thresholdDb')
    const lower = (db: number): Move[] => (threshold - db >= GATE_MIN_DB ? [{ slot: g, key: 'thresholdDb', to: threshold - db, reason: 'deadSilence', titleMsg: reasonMsg('words.threshold', { to: threshold - db }), metric: 'cutSpeech' }] : [])
    const floor = (dry: number): Move[] => (s.value(g, 'dryDb') < dry ? [{ slot: g, key: 'dryDb', to: dry, reason: 'deadSilence', titleMsg: reasonMsg('words.floor', { to: dry }), metric: 'cutSpeech' }] : [])
    const options = [lower(GATE_LOWER_DB / 3), lower((2 * GATE_LOWER_DB) / 3), lower(GATE_LOWER_DB), floor(GATE_DRY_STEPS[1]), floor(GATE_DRY_STEPS[2]), ...(round ? [longer(s, g)] : [])].filter((o) => o.length)
    const before = scoreOf(s.m, t, s.trim())
    let best: { set: NonNullable<ReturnType<Session['withMoves']>>; audio: Float32Array; m: Measured; total: number; clear: boolean; text: string } | null = null
    for (const moves of options) {
      const set = s.withMoves(stage, moves)
      if (!set) continue
      if (s.left(stage) < 1) {
        s.outOfBudget = true
        break
      }
      const { audio, m } = await s.render(stage, set)
      s.cut(set, audio, m)
      const score = scoreOf(m, t, s.trim(set))
      const text = moves.map((mv) => `${mv.key} → ${mv.to}`).join(', ')
      s.note(stage, 'render', `#${s.renders} gentler gate, ${text}: speech cut ${(100 * m.cutShare).toFixed(1)} % / ${m.cutEvents.toFixed(1)} per 10 s, room moved ${m.pumpDb.toFixed(1)} dB, voice over pauses ${m.snrDb.toFixed(1)} dB`, score)
      if (!(score.damage <= before.damage - MIN_GAIN)) continue
      const clear = !cutsSpeech(m) && !pumps(m)
      const rank = clear ? score.total : score.damage
      if (!best || (clear && !best.clear) || (clear === best.clear && rank < best.total)) best = { set, audio, m, total: rank, clear, text }
    }
    if (!best) {
      s.note(stage, 'info', 'no gentler gate cut less speech')
      return
    }
    s.note(stage, 'keep', `gentler gate, ${best.text}: speech cut ${(100 * s.m.cutShare).toFixed(1)} → ${(100 * best.m.cutShare).toFixed(1)} %, voice over pauses ${s.m.snrDb.toFixed(1)} → ${best.m.snrDb.toFixed(1)} dB`)
    s.set = best.set
    s.audio = best.audio
    s.m = best.m
  }
}

/** Where a Noise Removal's strength counts from for the amount's cap: where the chain had it, or 0 when it was off. */
export const nrBase = (nr: ChainSlot): number => (nr.on ? nr.values.strength : 0)

/**
 * "Metallic or robotic voice" picked: a Noise Removal stronger than the run allows (targets caps.nrCeil) comes down to
 * it, kept when nothing is damaged for it, whatever the room does (the result says the room comes back,
 * unmet.metallic).
 */
export async function toCeiling(s: Session, nr: ChainSlot): Promise<'done' | 'budget'> {
  const ceil = s.targets.caps.nrCeil
  if (!(s.value(nr, 'strength') > ceil)) return 'done'
  const move: Move = { slot: nr, key: 'strength', to: ceil, reason: 'deadSilence', titleMsg: reasonMsg('metallic.strength', { to: ceil }), metric: 'snrDb' }
  return (await s.tryMoves('noise', [move], 'noise', undefined, false, undefined, false, true)) === 'budget' ? 'budget' : 'done'
}

/**
 * Noise Removal one step stronger while the voice over the pauses is under the target and each step really wins
 * NOISE_MIN_GAIN_DB (half a step after one that did not), at most 3 renders, inside the amount's cap. What it cuts of
 * the words is checked on the final state (./burstStage.ts).
 */
export async function strengthen(s: Session, nr: ChainSlot): Promise<'done' | 'budget'> {
  const t = s.targets
  let step = t.caps.nrStep
  for (let pass = 0; pass < 3 && s.m.snrDb < t.snrDb && step >= 5; pass++) {
    const from = s.value(nr, 'strength')
    const to = Math.min(100, t.caps.nrCeil, nrBase(nr) + t.caps.nrMax, from + step)
    if (!(to > from)) break
    const move: Move = { slot: nr, key: 'strength', to, reason: 'noisyPause', titleMsg: reasonMsg('noise.strength', { snr: s.m.snrDb }), metric: 'snrDb' }
    const r = await s.tryMoves('noise', [move], 'noise', snrUp(NOISE_MIN_GAIN_DB))
    if (r === 'budget') return 'budget'
    if (r !== 'kept') step = Math.round(step / 2)
  }
  return 'done'
}

/**
 * Compression: when the level spread is above the target, the last switched-on ReaComp gets the amount's ratio (if
 * it sits lower) and a threshold COMP_UNDER_SPEECH_DB under the speech level it receives (the raw speech level plus
 * what the gates before it add), if it sits higher, inside the guide's −45..−12 dB; a second pass goes
 * COMP_DEEPER_DB lower. The amount caps the ratio, not the threshold (where the threshold belongs follows from how
 * loud the voice is, not from how much processing is wanted). Kept only when the
 * spread really narrowed SPREAD_MIN_GAIN_DB: the level it costs is the final trim's job and does not count against
 * it, but room noise it lifts into the pauses does.
 */
export async function compressionStage(s: Session): Promise<void> {
  const t = s.targets
  if (!s.m.silent && s.m.spreadDb < t.spreadMinDb) return letGo(s)
  if (s.m.silent || !(s.m.spreadDb > t.spreadDb)) return
  const comp = s.live('reacomp', 'thresholdDb', 'ratio').at(-1)
  if (!comp) return
  const pre = s.live('reagate', 'wetDb', 'dryDb')
    .filter((g) => g.index < comp.index && !gateIsOff(gateOf(s, g)))
    .reduce((sum, g) => sum + openGainDb(gateOf(s, g)), 0)
  const floor = COMP_THRESHOLD_RANGE[0]
  const plan = clamp(Math.round(s.mask.analysis.speechMed + pre - COMP_UNDER_SPEECH_DB), COMP_THRESHOLD_RANGE[0], COMP_THRESHOLD_RANGE[1])
  // a compressor lifts what Noise Removal lets through in the pauses with the quiet words (about 5 dB on the real
  // chain, where the gate that would close on them then cuts words). Clean pauses come first, so that holds it back,
  // unless "uneven volume" was picked: then only bursts closer than COMP_BURST_OK_DB to the voice do. The burst
  // stage after it still works on them against the full target, and the result says what is left.
  const judge: TuneTargets | undefined = t.evenFirst ? { ...t, burstSnrDb: COMP_BURST_OK_DB } : undefined
  const narrower = (b: Measured, a: Measured): string | null => (a.spreadDb <= b.spreadDb - SPREAD_MIN_GAIN_DB ? null : `level spread ${b.spreadDb.toFixed(1)} → ${a.spreadDb.toFixed(1)} dB: not enough`)

  for (let pass = 0; pass < 2 && s.m.spreadDb > t.spreadDb; pass++) {
    const ratio = s.value(comp, 'ratio')
    const threshold = s.value(comp, 'thresholdDb')
    const moves: Move[] = []
    const toRatio = Math.round(t.caps.ratio * 10) / 10
    if (pass === 0 && ratio < toRatio - 0.05) {
      moves.push({ slot: comp, key: 'ratio', to: toRatio, reason: 'tooLoud', titleMsg: reasonMsg('comp.ratio', { spread: s.m.spreadDb, to: toRatio }), metric: 'spreadDb' })
    }
    const toThreshold = Math.max(floor, pass === 0 ? plan : Math.min(threshold, plan) - COMP_DEEPER_DB)
    if (toThreshold <= threshold - 1) {
      moves.push({ slot: comp, key: 'thresholdDb', to: toThreshold, reason: 'tooLoud', titleMsg: reasonMsg('comp.threshold', { spread: s.m.spreadDb, to: toThreshold }), metric: 'spreadDb' })
    }
    if (!moves.length) continue
    if ((await tryWithGates(s, 'compression', moves, 'consistency', narrower, judge)) !== 'kept') return
  }
}
