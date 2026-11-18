// What the live noise calibration may change (SPEC "Calibrate noise live"). Pure. The ladders, steps and caps are the
// tuner's (../tune/targets.ts, ../tune/stages.ts, ../../plain/refine.ts); only where it needs a measurement the tuner
// makes from a render does this read the live stream instead.
import { GATE_MIN_DB, GATE_SOFT_DRY_DB, gateIsOff, gatePassesAll, openGainDb } from '../../plain/refine'
import { slotsWith } from '../advice/chain'
import type { ChainSlot } from '../advice/types'
import { GATE_DRY_STEPS, GATE_GAP_SHARE, GATE_HOLD_MS, GATE_LOWER_DB, GATE_OVER_ROOM_DB, GATE_RELEASE_MS, GATE_SAFE_DB } from '../tune/stages'
import { PUMP_OK_DB } from '../tune/score'
import { nrLadder, type TuneCaps } from '../tune/targets'

/** The effect that does the work: Elgato Noise Removal when the chain has one, else its last ReaGate. */
export type Remover = { kind: 'nr'; slot: ChainSlot } | { kind: 'gate'; slot: ChainSlot }

const hasAll = (s: ChainSlot, ...keys: string[]): boolean => keys.every((k) => Number.isFinite(s.values[k]))

/** The chain's remover (a slot switched off counts: it can be switched on), null when it has none. */
export function removerOf(chain: readonly ChainSlot[]): Remover | null {
  const nr = chain.find((s) => s.kind === 'noiseRemoval' && hasAll(s, 'strength'))
  if (nr) return { kind: 'nr', slot: nr }
  const gate = chain.filter((s) => s.kind === 'reagate' && hasAll(s, 'thresholdDb', 'wetDb', 'dryDb')).at(-1)
  return gate ? { kind: 'gate', slot: gate } : null
}

/** Switched-on ReaFIRs: off once the Noise Removal does the work (on the real chain one took 15 dB of the voice's lows for 1.7 dB of room). */
export const reafirsOn = (chain: readonly ChainSlot[]): ChainSlot[] => chain.filter((s) => s.kind === 'reafir' && s.on)

/**
 * Strengths of a Noise Removal, lightest first. Switched off: the tuner's ladder counted from 0 (nrLadder). Already on
 * at `s0`: one step (the amount's) at a time from there, at most the amount's cap above it (the tuner's strengthen).
 */
export function strengthLadder(nr: ChainSlot, caps: Pick<TuneCaps, 'nrStep' | 'nrMax'>): number[] {
  if (!nr.on) return nrLadder(caps)
  const s0 = nr.values.strength
  const top = Math.min(100, s0 + caps.nrMax)
  const out = [s0]
  for (let v = s0 + caps.nrStep; out[out.length - 1] < top - 1e-9; v += caps.nrStep) out.push(Math.min(top, v))
  return out
}

/** The next rung above / below `at` on a ladder, or null at its end. */
export const rungAbove = (ladder: readonly number[], at: number): number | null => ladder.find((v) => v > at + 1e-9) ?? null
export const rungBelow = (ladder: readonly number[], at: number): number | null => [...ladder].reverse().find((v) => v < at - 1e-9) ?? null

/** Gate values in real units (ReaGate keys). */
export type GateValues = Partial<Record<'thresholdDb' | 'wetDb' | 'dryDb' | 'holdMs' | 'releaseMs', number>>

/** The gate passing everything (Wet off, Dry 0 dB): what it receives then plays out, as the tuner's probe render. */
export const GATE_PASS: GateValues = { wetDb: -100, dryDb: 0 }

/**
 * A gate's input can be read from the output only behind a compressor (a gain stage that moves the room by its make-up)
 * with nothing after the gate that removes noise; else the raw mic says what it receives (the tuner's gateInputDb).
 */
export function gateNeedsProbe(chain: readonly ChainSlot[], gate: ChainSlot): boolean {
  const before = slotsWith(chain, 'reacomp').some((c) => c.index < gate.index)
  const after = chain.some((c) => c.on && c.index > gate.index && (c.kind === 'noiseRemoval' || c.kind === 'reafir' || c.kind === 'reagate'))
  return before && !after
}

/** Room peaks a gate's threshold sits over, dB: a few dB, so it closes on the pauses (the tuner's GATE_LOWER_DB step). */
export const GATE_OVER_PEAKS_DB = GATE_LOWER_DB

const r05 = (v: number): number => Math.round(v * 2) / 2 || 0
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const gateOf = (g: ChainSlot): { wet: number; dry: number } => ({ wet: g.values.wetDb, dry: g.values.dryDb })

/** How far a gate moves what it lets through between open (Wet + Dry) and closed (Dry): what it pumps an audible room by, dB. */
export const swingDb = (wetDb: number, dryDb: number): number => openGainDb({ wet: wetDb, dry: dryDb }) - dryDb

/**
 * The deepest of the tuner's floors (GATE_DRY_STEPS) that does not pump an audible room with Wet at `wetDb`: its swing
 * at most PUMP_OK_DB (with Wet 0 dB that is Dry −6: −12 swings 13.9 dB, as the tuner's pump measure reads it).
 */
export const pumpSafeFloor = (wetDb: number): number =>
  [...GATE_DRY_STEPS].sort((a, b) => a - b).find((d) => swingDb(wetDb, d) <= PUMP_OK_DB) ?? Math.max(...GATE_DRY_STEPS)

/**
 * Where the gate goes, from the room peaks it receives (`pausePeakDb`, its input): its threshold GATE_OVER_PEAKS_DB over
 * them; its floor the deepest that cannot pump an audible room (pumpSafeFloor), or a shallower floor it already had;
 * Wet 0 dB when it was off; with a floor shallower than GATE_SOFT_DRY_DB, the tuner's hold and release for word tails.
 */
export function gatePlacement(g: ChainSlot, pausePeakDb: number): GateValues {
  const out: GateValues = { thresholdDb: r05(clamp(pausePeakDb + GATE_OVER_PEAKS_DB, GATE_MIN_DB, 0)) }
  const wet = gateIsOff(gateOf(g)) ? 0 : g.values.wetDb
  if (wet !== g.values.wetDb) out.wetDb = wet
  const safe = pumpSafeFloor(wet)
  const dry = g.values.dryDb
  out.dryDb = gatePassesAll({ wet, dry }) || dry < safe ? safe : dry
  return { ...out, ...longerTimes(g, out.dryDb) }
}

/** The tuner's hold and release with a floor shallower than GATE_SOFT_DRY_DB, where the gate has shorter ones. */
function longerTimes(g: ChainSlot, dry: number): GateValues {
  if (dry <= GATE_SOFT_DRY_DB) return {}
  const out: GateValues = {}
  if (Number.isFinite(g.values.holdMs) && g.values.holdMs < GATE_HOLD_MS) out.holdMs = GATE_HOLD_MS
  if (Number.isFinite(g.values.releaseMs) && g.values.releaseMs < GATE_RELEASE_MS) out.releaseMs = GATE_RELEASE_MS
  return out
}

/**
 * Never inside speech: a threshold that is not GATE_SAFE_DB under the quiet syllables' peaks it receives comes down to
 * where the tuner puts it (GATE_GAP_SHARE of the way from the room peaks, GATE_SAFE_DB under the syllables, at least
 * GATE_OVER_ROOM_DB over the room). Null when it already sits there.
 */
export function gateUnderSpeech(g: ChainSlot, pausePeakDb: number, quietPeakDb: number): GateValues | null {
  const gap = quietPeakDb - pausePeakDb
  if (!Number.isFinite(gap) || g.values.thresholdDb <= quietPeakDb - GATE_SAFE_DB) return null
  const place = Math.max(pausePeakDb + GATE_OVER_ROOM_DB, Math.min(pausePeakDb + GATE_GAP_SHARE * gap, quietPeakDb - GATE_SAFE_DB))
  const to = r05(clamp(place, GATE_MIN_DB, 0))
  return to < g.values.thresholdDb ? { thresholdDb: to } : null
}

/**
 * A gentler gate after it cut words, one step per check (the tuner's protectWords options, one at a time live): its
 * threshold GATE_LOWER_DB lower (not under the room peaks), then the longer hold and release, then the shallowest floor.
 * Null when nothing is left.
 */
export function gateGentler(g: ChainSlot, pausePeakDb: number): GateValues | null {
  const lower = r05(Math.max(pausePeakDb + GATE_OVER_ROOM_DB, g.values.thresholdDb - GATE_LOWER_DB))
  if (lower < g.values.thresholdDb - 0.25) return { thresholdDb: lower }
  const times = longerTimes(g, GATE_DRY_STEPS[2])
  if (Object.keys(times).length) return times
  const shallow = GATE_DRY_STEPS[2]
  return g.values.dryDb < shallow ? { dryDb: shallow, ...longerTimes(g, shallow) } : null
}

/** The gate's floor one step deeper (more) or shallower (less) on the tuner's floors (−20 / −12 / −6 dB); null at the end. */
export function gateFloorStep(g: ChainSlot, dir: 'more' | 'less'): GateValues | null {
  const floors = [...GATE_DRY_STEPS].sort((a, b) => a - b)
  const dry = g.values.dryDb
  const to = dir === 'more' ? [...floors].reverse().find((f) => f < dry - 0.25) : floors.find((f) => f > dry + 0.25)
  return to === undefined ? null : { dryDb: to, ...longerTimes(g, to) }
}
