// The level, noise & gate, compression and final-trim stages. Each proposes a move from what the kept render
// measures, and Session.tryMoves keeps it only when the next render proves it (./session.ts).
import { OVER_SWITCH_WARN, PEAK_WARN_DB } from '../../audio/diagnose'
import { CHOPPED_ZERO, GATE_MIN_DB, GATE_OFF_WET_DB, GATE_SOFT_DRY_DB, GATE_STEP_DB, gateDoubles, gateIsOff, gatePassesAll, openGainDb } from '../../plain/refine'
import { sameValue, slotsWith } from '../advice/chain'
import type { ChainSlot } from '../advice/types'
import type { Measured } from './measure'
import { reasonMsg } from './msgs'
import { CHOP_OK_DB, LEVEL_TOL_DB, type ScorePart } from './score'
import type { Move, Outcome, Session } from './session'
import type { TuneStage } from './types'

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
    if ((await s.tryMoves(stage, [move, ...follow], 'level', check, true)) !== 'kept') return
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
export const GATE_GAP_SHARE = 0.7
/** Pause peaks and quiet syllables' peaks closer than this: no threshold tells them apart, dB. */
export const GATE_GAP_MIN_DB = 3

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
/** A room's sample peaks sit about this far over its RMS (real take: −41.4 dBFS RMS, peaks P50 −32), dB. */
export const ROOM_CREST_DB = 10
/** The gate values that pass everything at unity (Wet off, Dry 0 dB): a probe render shows what the gate receives. */
const PASS: { wet: number; dry: number } = { wet: GATE_OFF_WET_DB, dry: 0 }

/** A ReaComp before the gate and nothing after it that removes noise: what it receives can be read from a render. */
const readable = (s: Session, g: ChainSlot): boolean =>
  s.chain.some((c) => c.on && c.kind === 'reacomp' && c.index < g.index) &&
  !s.chain.some((c) => c.on && c.index > g.index && (c.kind === 'noiseRemoval' || c.kind === 'reafir' || c.kind === 'reagate'))

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
 *   threshold goes GATE_GAP_SHARE of the way from the pause peaks to the quiet syllables' peaks; closer than
 *   GATE_GAP_MIN_DB there is no such place. (Real chain: pause peaks −27.9, quiet syllables −22.7 → −24.5: voice over
 *   pauses 15 → about 33 dB, no word lost; the guide's room + 6 dB, −36, never closed.)
 * - Raw levels: the guide's threshold (gatePlanDb), 30 dB under the speech behind a noise remover.
 * The amount's cap counts from where the gate starts to act: a threshold under the room does nothing, so a move up
 * to the room is not processing yet.
 */
function gateTargetDb(s: Session, g: ChainSlot, lv: GateInput = gateInputDb(s, g)): number {
  const cap = s.targets.caps.gateDb
  if (lv.measured) {
    const gap = lv.quietPeakDb - lv.pausePeakDb
    if (!(gap >= GATE_GAP_MIN_DB)) return NaN
    return r05(clamp(Math.min(lv.pausePeakDb + GATE_GAP_SHARE * gap, Math.max(g.values.thresholdDb, lv.pausePeakDb) + cap), GATE_MIN_DB, 0))
  }
  const removal = s.chain.some((c) => c.on && (c.kind === 'noiseRemoval' || c.kind === 'reafir'))
  return r05(Math.min(gatePlanDb(lv.speechDb, lv.noiseDb, removal), Math.max(g.values.thresholdDb, lv.noiseDb) + cap))
}

/**
 * Higher thresholds for working gates (readable ones, not already moved) with `moves` applied, from one probe render
 * with those gates passing everything: what they receive cannot be read through a gate that closes on some pauses.
 * Null without such a gate, without two renders left (the probe and the candidate) or when no higher threshold helps.
 */
async function replaceGates(s: Session, stage: TuneStage, moves: readonly Move[], after: number): Promise<Move[] | null> {
  const gates = slotsWith(s.chain, 'reagate', 'thresholdDb', 'wetDb', 'dryDb').filter(
    (g) => g.index > after && readable(s, g) && !gatePassesAll(gateOf(s, g)) && !moves.some((mv) => mv.slot.index === g.index),
  )
  if (!gates.length || s.left(stage) < 2) return null
  const pass = gates.flatMap((g): Move[] => [
    { slot: g, key: 'wetDb', to: PASS.wet, reason: 'noisyPause', titleMsg: reasonMsg('noise.threshold', { to: 0 }), metric: 'snrDb' },
    { slot: g, key: 'dryDb', to: PASS.dry, reason: 'noisyPause', titleMsg: reasonMsg('noise.threshold', { to: 0 }), metric: 'snrDb' },
  ])
  const probe = s.withMoves(stage, [...moves, ...pass])
  if (!probe) return null
  const { m } = await s.render(stage, probe)
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
 * it.
 */
export async function tryWithGates(s: Session, stage: TuneStage, moves: readonly Move[], part: ScorePart, check?: (before: Measured, after: Measured) => string | null): Promise<Outcome> {
  const renders = s.renders
  const r = await s.tryMoves(stage, moves, part, check)
  if (r !== 'reverted' || s.renders === renders || !(s.last.snrDb < s.m.snrDb - GATE_OPENED_DB)) return r
  const extra = await replaceGates(s, stage, moves, Math.min(...moves.map((mv) => mv.slot.index)))
  if (!extra) return r
  return s.tryMoves(stage, [...moves, ...extra], part, check)
}

/** Working gates after the last gain stage: their threshold follows a Wet move, so they keep closing where they did. */
function followers(s: Session): ChainSlot[] {
  const gain = s.gain
  if (!gain) return []
  return slotsWith(s.chain, 'reagate', 'thresholdDb', 'wetDb', 'dryDb').filter((g) => g.index > gain.slot.index && !gatePassesAll(gateOf(s, g)))
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
  const gates = slotsWith(s.chain, 'reagate', 'thresholdDb', 'wetDb', 'dryDb')
  const nr = slotsWith(s.chain, 'noiseRemoval', 'strength')[0]
  const snrUp = (min: number) => (b: Measured, a: Measured): string | null => (a.snrDb >= b.snrDb + min ? null : `voice over pauses ${b.snrDb.toFixed(1)} → ${a.snrDb.toFixed(1)} dB: not enough`)

  for (const g of gates) {
    const gate = gateOf(s, g)
    if (!gateDoubles(gate)) continue
    const moves: Move[] = [{ slot: g, key: 'dryDb', to: GATE_SOFT_DRY_DB, reason: 'gateDoubled', titleMsg: reasonMsg('gateDoubled', { from: gate.dry, to: GATE_SOFT_DRY_DB }), metric: 'snrDb' }]
    // a gate opening on every pause it receives: Dry alone would change nothing but the level
    const from = s.value(g, 'thresholdDb')
    const to = gateTargetDb(s, g)
    if (neverCloses(gateInputDb(s, g), from) && to >= from + 1) {
      moves.push({ slot: g, key: 'thresholdDb', to, reason: 'noisyPause', titleMsg: reasonMsg('noise.threshold', { to }), metric: 'snrDb' })
    }
    if ((await s.tryMoves('noise', moves, 'noise', snrUp(DOUBLED_MIN_GAIN_DB))) === 'budget') return
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
    const floor = nr ? Math.max(0, nr.values.strength - caps.nrMax) : 0
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
  if (dead(s.m) || chopped(s.m)) return

  let step = caps.nrStep
  for (let pass = 0; pass < 3 && nr && s.m.snrDb < t.snrDb && step >= 5; pass++) {
    const from = s.value(nr, 'strength')
    const to = Math.min(100, nr.values.strength + caps.nrMax, from + step)
    if (!(to > from)) break
    const move: Move = { slot: nr, key: 'strength', to, reason: 'noisyPause', titleMsg: reasonMsg('noise.strength', { snr: s.m.snrDb }), metric: 'snrDb' }
    const r = await s.tryMoves('noise', [move], 'noise', snrUp(NOISE_MIN_GAIN_DB))
    if (r === 'budget') return
    if (r !== 'kept') step = Math.round(step / 2)
  }

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
  if (s.m.silent || !(s.m.spreadDb > t.spreadDb)) return
  const comp = slotsWith(s.chain, 'reacomp', 'thresholdDb', 'ratio').at(-1)
  if (!comp) return
  const pre = slotsWith(s.chain, 'reagate', 'wetDb', 'dryDb')
    .filter((g) => g.index < comp.index && !gateIsOff(gateOf(s, g)))
    .reduce((sum, g) => sum + openGainDb(gateOf(s, g)), 0)
  const floor = COMP_THRESHOLD_RANGE[0]
  const plan = clamp(Math.round(s.mask.analysis.speechMed + pre - COMP_UNDER_SPEECH_DB), COMP_THRESHOLD_RANGE[0], COMP_THRESHOLD_RANGE[1])
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
    if ((await tryWithGates(s, 'compression', moves, 'consistency', narrower)) !== 'kept') return
  }
}
