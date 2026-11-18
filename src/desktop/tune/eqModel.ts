// The tuner's EQ model. Pure.
// It plans ReaEQ moves from the take's own measured speech spectrum and each band's nominal curve
// (src/audio/eqCurve.ts): the gains first (planTone), then, when gains alone leave a band out of tolerance, a band's
// frequency and width too (planShaped: a narrow cut placed on a hump that sits next to a hole). It corrects itself
// from a render: calibrate() fits how much of its nominal curve each moved band REALLY produced in the rendered
// audio, and the next plan uses that. A band that does nothing where the voice needs it (a 10 kHz shelf for a
// 5–10 kHz problem) therefore stops being moved.
import { eqResponseDb } from '../../audio/eqCurve'
import { BANDS } from '../../audio/reference'
import { isNotch } from '../../settings/suggest'
import type { EqTypeName } from '../../wavelink/fxp'
import { eqBands, eqKey, slotsWith } from '../advice/chain'
import type { ChainSlot } from '../advice/types'
import { bandsOfCells, CELLS_PER_BAND, N_CELLS, toneAt, toneLevel } from './measure'
import { N_BANDS, toneExcess, type TuneTargets } from './targets'

/** EQ gains move on this grid, dB. */
export const EQ_GRID_DB = 0.5
/** The solver aims this far inside each tolerance, so a band does not end on the edge, dB. */
export const AIM_MARGIN_DB = 0.5
/**
 * Cost of each dB of EQ moved, in dB of tone excess: a move must take at least a quarter of its own size off the
 * bands that are out of tolerance, so a band is never pushed hard for what it barely spills onto a far band.
 */
export const MOVE_COST = 0.25
/**
 * Fixing one band may cost another only a little: the plan never pushes a band more than PLAN_WORSEN_MAX_DB further
 * outside its tolerance than it measures now (the render check allows 1 dB, the rest is room for model error), and
 * every dB it does push counts WORSEN_WEIGHT times.
 */
export const PLAN_WORSEN_MAX_DB = 0.75
export const WORSEN_WEIGHT = 2
/** Smallest EQ move worth making, dB (suggest() drops smaller ones too). */
export const EQ_MIN_MOVE_DB = 1
/** An EQ band "reaches" a tone band when it moves it by at least this share of its own gain. */
export const REACH_SHARE = 0.3
/**
 * An EQ band moves at most this many times the largest excess among the tone bands it reaches: a complaint that
 * measures 1 dB gets a 1.5 dB nudge (the guide's "by ear" tweak), never a 4 dB cut next door.
 */
export const NEED_FACTOR = 1.5
/** In a noisy room (SNR below NOISY_SNR), a band whose voice-over-room SNR is below this is not boosted (suggest.ts). */
export const NOISY_SNR = 25
export const NO_BOOST_SNR = 12
/**
 * Shape moves (a band's frequency and width). A band moves at most SHAPE_OCT octaves from where the chain had it and
 * stays inside the voice range; its width stays within SHAPE_BW; a shelf stays a shelf and only its corner moves
 * (SHELF_HZ). At most MAX_SHAPED bands change shape in one plan, and only while gains alone leave SHAPE_MIN_EXCESS_DB
 * of weighted excess. Each reshaped band costs SHAPE_COST in the plan (dB of excess) on top of the dB it moves, so a
 * shape only moves when placing the band buys more than pushing its gain.
 */
export const SHAPE_OCT = 1
export const SHAPE_VOICE_HZ: readonly [number, number] = [80, 8000]
export const SHELF_HZ: readonly [number, number] = [60, 12000]
export const SHAPE_BW: readonly [number, number] = [0.3, 2.5]
export const SHAPE_WIDTHS: readonly number[] = [0.5, 1, 1.5]
export const MAX_SHAPED = 2
export const SHAPE_MIN_EXCESS_DB = 2
export const SHAPE_COST = 2
/** Share of a moved band's own curve energy that pulls its fitted strength toward 1 (keeps overlapping bands apart). */
const RIDGE = 0.05
/** A fitted strength is kept inside this range (1 = the band did exactly what its curve says). */
const RHO_MAX = 2

/** One tunable ReaEQ band. */
export interface EqHandle {
  slot: ChainSlot
  /** 1-based band number. */
  n: number
  /** Value key of its gain. */
  key: string
  type: EqTypeName
  freqHz: number
  bwOct: number
  /** Gain when the chain started, dB. */
  base: number
  /** Allowed gains, dB: the guide's range for that kind of band, at most the amount's step from `base`. */
  lo: number
  hi: number
  /** Frequency and width when the chain started (`freqHz` / `bwOct` are where the plan has the band). */
  baseFreqHz: number
  baseBwOct: number
  /** The amount's largest move of one band, dB: of its gain, or of its whole curve once its shape moved. */
  capDb: number
}

/** The band sits where the chain had it (only its gain can differ). */
export const sameShape = (h: Pick<EqHandle, 'freqHz' | 'bwOct' | 'baseFreqHz' | 'baseBwOct'>): boolean => h.freqHz === h.baseFreqHz && h.bwOct === h.baseBwOct

const r05 = (v: number): number => Math.round(v / EQ_GRID_DB) * EQ_GRID_DB || 0
/** BANDS index a frequency falls in (the last band above 16 kHz). */
const bandAt = (hz: number): number => {
  const i = BANDS.findIndex((b) => hz < b.hi)
  return i < 0 ? N_BANDS - 1 : i
}

/** Gain range the guide gives that kind of band (suggest(): Low Shelf −8..2, bands −6..3 / −5..3 / −4..4 / −4..5, High Shelf −4..5). */
export function guideRange(type: EqTypeName, freqHz: number): [number, number] {
  if (type === 'Low Shelf') return [-8, 2]
  if (type === 'High Shelf') return [-4, 5]
  if (freqHz < 350) return [-6, 3]
  if (freqHz < 700) return [-5, 3]
  if (freqHz < 2000) return [-4, 4]
  return [-4, 5]
}

/** Band indexes lo..hi. */
const span = (lo: number, hi: number): number[] => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k)

/**
 * BANDS indexes a handle moves (for the no-boost rule). A shelf lifts every band past its corner: a 150 Hz low shelf
 * also lifts the rumble under it, where a room's fan noise lives (on the real chain a +2 dB low shelf cost 1.4 dB of
 * voice over the room in a noisy take).
 */
export function touched(h: Pick<EqHandle, 'type' | 'freqHz'>): number[] {
  if (h.type === 'Low Shelf') return span(0, bandAt(h.freqHz / Math.SQRT2))
  if (h.type === 'High Shelf') return span(bandAt(h.freqHz / Math.SQRT2), N_BANDS - 1)
  return [bandAt(h.freqHz)]
}

/**
 * The tunable EQ bands: enabled Low Shelf / Band / High Shelf bands of switched-on ReaEQ slots, except notches (a
 * narrow deep cut for a fan tone is not a tone control). `stepDb` is the amount's largest move per band; `noBoost`
 * says whether a BANDS index may not be lifted (room noise wins there), which caps the gain at 0 dB or where it is.
 */
export function eqHandles(chain: readonly ChainSlot[], stepDb: number, noBoost: (band: number) => boolean): EqHandle[] {
  const out: EqHandle[] = []
  for (const slot of slotsWith(chain, 'reaeq')) {
    for (const b of eqBands(slot)) {
      if (!b.on || b.type === 'Other' || !(b.freqHz > 0) || !Number.isFinite(b.gainDb) || !(b.bwOct > 0)) continue
      if (isNotch({ type: b.type, bw: b.bwOct })) continue
      const [gLo, gHi] = guideRange(b.type, b.freqHz)
      const base = b.gainDb
      const h = { type: b.type, freqHz: b.freqHz }
      const ceil = touched(h).some(noBoost) ? Math.min(gHi, 0) : gHi
      out.push({
        slot,
        n: b.n,
        key: eqKey(b.n, 'gainDb'),
        type: b.type,
        freqHz: b.freqHz,
        bwOct: b.bwOct,
        base,
        lo: Math.min(base, Math.max(gLo, base - stepDb)),
        hi: Math.max(base, Math.min(ceil, base + stepDb)),
        baseFreqHz: b.freqHz,
        baseBwOct: b.bwOct,
        capDb: stepDb,
      })
    }
  }
  return out
}

/**
 * The handle at another frequency / width (back at the chain's: the handle as eqHandles made it, given as `home`).
 * Its gain range there is the guide's for that place (no lift where `noBoost` says the room wins); how far the band
 * as a whole may move is the plan's business (EqCurves.movedDb against `capDb`).
 */
export function reshape(home: EqHandle, freqHz: number, bwOct: number, noBoost: (band: number) => boolean): EqHandle {
  if (freqHz === home.baseFreqHz && bwOct === home.baseBwOct) return home
  const [gLo, gHi] = guideRange(home.type, freqHz)
  const ceil = touched({ type: home.type, freqHz }).some(noBoost) ? Math.min(gHi, 0) : gHi
  return { ...home, freqHz, bwOct, lo: gLo, hi: Math.max(gLo, ceil) }
}

const clampTo = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v))

/**
 * Other places a band could sit for the tone bands that need help (`bands`: BANDS indexes): a Band on the centre and
 * the lower / upper part of each such band it can reach within SHAPE_OCT, or where it is, at SHAPE_WIDTHS and its own
 * width; a shelf with its corner half an octave or an octave away. Frequencies in whole Hz.
 */
export function shapeVariants(h: EqHandle, bands: readonly number[]): { freqHz: number; bwOct: number }[] {
  const out = new Map<string, { freqHz: number; bwOct: number }>()
  const add = (freqHz: number, bwOct: number): void => {
    const f = Math.round(freqHz)
    const w = Math.round(bwOct * 20) / 20
    if (f === h.freqHz && w === h.bwOct) return
    out.set(`${f}:${w}`, { freqHz: f, bwOct: w })
  }
  const near = (hz: number): boolean => Math.abs(Math.log2(hz / h.baseFreqHz)) <= SHAPE_OCT + 1e-9
  if (h.type !== 'Band') {
    for (const k of [-1, -0.5, 0.5, 1]) {
      const hz = h.baseFreqHz * 2 ** k
      if (hz >= SHELF_HZ[0] && hz <= SHELF_HZ[1]) add(hz, h.bwOct)
    }
    return [...out.values()]
  }
  const widths = [...SHAPE_WIDTHS, clampTo(h.baseBwOct, SHAPE_BW)]
  const centres = [h.baseFreqHz]
  for (const b of bands) for (const q of [0.25, 0.5, 0.75]) centres.push(BANDS[b].lo * (BANDS[b].hi / BANDS[b].lo) ** q)
  for (const hz of centres) {
    if (!near(hz) || hz < SHAPE_VOICE_HZ[0] || hz > SHAPE_VOICE_HZ[1]) continue
    for (const w of widths) add(hz, w)
  }
  return [...out.values()]
}

/**
 * Nominal curves of the handles at the cell centres, cached per gain. One EqCurves is one set of band shapes: a plan
 * that moves a band's frequency or width is another EqCurves (`with`), and the change between two of them is
 * `delta(from, to, rho, was)` with `was` the curves the `from` gains belong to.
 */
export class EqCurves {
  private readonly cache = new Map<string, Float64Array>()
  private readonly movedCache = new Map<string, number>()
  constructor(
    readonly handles: readonly EqHandle[],
    readonly cellHz: readonly number[],
    readonly sampleRate: number,
  ) {}

  /** The same curves with handle `i` replaced (another shape). */
  with(i: number, h: EqHandle): EqCurves {
    return new EqCurves(
      this.handles.map((x, k) => (k === i ? h : x)),
      this.cellHz,
      this.sampleRate,
    )
  }

  /** Response of handle `i` as the chain had it (its own frequency, width and gain). */
  baseCurve(i: number): Float64Array {
    let c = this.cache.get(`${i}:base`)
    if (!c) {
      const h = this.handles[i]
      c = Float64Array.from(eqResponseDb([{ type: h.type, freq: h.baseFreqHz, gain: h.base, bw: h.baseBwOct }], this.cellHz, this.sampleRate))
      this.cache.set(`${i}:base`, c)
    }
    return c
  }

  /**
   * How far handle `i` at `gainDb` is from where the chain had it, dB: its gain move, or, once its shape moved, the
   * largest change of its curve anywhere (a −4 dB band moved an octave away takes 4 dB off there and gives 4 dB back
   * here: a 4 dB move, like a gain change of that size). This is what the amount's caps count.
   */
  movedDb(i: number, gainDb: number): number {
    const h = this.handles[i]
    if (sameShape(h)) return Math.abs(gainDb - h.base)
    const key = `${i}:${gainDb}`
    let m = this.movedCache.get(key)
    if (m === undefined) {
      const a = this.baseCurve(i)
      const b = this.curve(i, gainDb)
      m = 0
      for (let c = 0; c < N_CELLS; c++) m = Math.max(m, Math.abs(b[c] - a[c]))
      this.movedCache.set(key, m)
    }
    return m
  }

  /** Response (dB per cell) of handle `i` at `gainDb`. */
  curve(i: number, gainDb: number): Float64Array {
    const key = `${i}:${gainDb}`
    let c = this.cache.get(key)
    if (!c) {
      const h = this.handles[i]
      c = Float64Array.from(eqResponseDb([{ type: h.type, freq: h.freqHz, gain: gainDb, bw: h.bwOct }], this.cellHz, this.sampleRate))
      this.cache.set(key, c)
    }
    return c
  }

  /**
   * Predicted change per cell, dB, when the gains go from `from` to `to`, each band scaled by its fitted strength.
   * `was`: the curves (band shapes) the `from` gains belong to, when a band's shape moves too.
   */
  delta(from: readonly number[], to: readonly number[], rho: readonly number[], was: EqCurves = this): Float64Array {
    const d = new Float64Array(N_CELLS)
    this.handles.forEach((h, i) => {
      const w = was.handles[i]
      if (to[i] === from[i] && h.freqHz === w.freqHz && h.bwOct === w.bwOct) return
      const a = was.curve(i, from[i])
      const b = this.curve(i, to[i])
      for (let c = 0; c < N_CELLS; c++) d[c] += rho[i] * (b[c] - a[c])
    })
    return d
  }

  /** Whether handle `i` reaches each BANDS entry (REACH_SHARE of a 2 dB move). */
  reaches(i: number): boolean[] {
    const base = this.handles[i].base
    return this.bandDelta(i, base, base - 2).map((d) => Math.abs(d) >= 2 * REACH_SHARE)
  }

  /** Mean change of each BANDS entry, dB, when only handle `i` goes from `from` (in `was`'s shape) to `to`. */
  bandDelta(i: number, from: number, to: number, was: EqCurves = this): number[] {
    const a = was.curve(i, from)
    const b = this.curve(i, to)
    return Array.from({ length: N_BANDS }, (_, band) => {
      let s = 0
      for (let k = 0; k < CELLS_PER_BAND; k++) s += b[band * CELLS_PER_BAND + k] - a[band * CELLS_PER_BAND + k]
      return s / CELLS_PER_BAND
    })
  }
}

/**
 * Tone deviations the model predicts when the measured cells change by `delta` dB, at the matching level of the
 * measured take (`level`, toneLevel of `cells`). The level is NOT matched again: otherwise lifting every healthy band
 * would "fix" one band that is too strong, which is the across-the-board EQ this tuner must never do. A band is
 * moved only for what it does to the bands it reaches.
 */
export function predictTone(cells: ArrayLike<number>, delta: ArrayLike<number>, t: TuneTargets, level: number): number[] {
  return toneAt(predictBands(cells, delta), t.style, level)
}

/** Band energies (bandsOfCells) the model predicts when the measured cells change by `delta` dB. */
export const predictBands = (cells: ArrayLike<number>, delta: ArrayLike<number>): number[] => bandsOfCells(shifted(cells, delta))

const shifted = (cells: ArrayLike<number>, delta: ArrayLike<number>): Float64Array => {
  const out = new Float64Array(N_CELLS)
  for (let c = 0; c < N_CELLS; c++) out[c] = cells[c] * 10 ** (delta[c] / 10)
  return out
}

/**
 * Gains (one per handle) that bring the tone inside its tolerances with the least EQ, by steepest descent on the
 * 0.5 dB grid: at each step the one gain change that lowers the cost the most is taken, until none lowers it (so the
 * biggest problems get the EQ budget first). Cost = Σ weight × excess (aimed AIM_MARGIN_DB inside the tolerances)
 * + MOVE_COST × Σ |move from the chain's start| + what the plan pushes other bands out, counted WORSEN_WEIGHT times,
 * all at the frozen level.
 * Rules a gain must keep:
 * - no band ends more than PLAN_WORSEN_MAX_DB further outside its tolerance than it measures now, at the frozen level
 *   (what the EQ itself does to it; the stage's keep check reads it the same way);
 * - a band stays where the chain had it or moves at least EQ_MIN_MOVE_DB;
 * - it moves at most NEED_FACTOR × the largest excess among the bands it reaches from where it is now;
 * - it stays in its handle's range, and the moves from the chain's start sum to at most `totalDb`.
 * `cells` is the spectrum measured with the gains at `current`; `rho` the fitted strength of each band (1 before any
 * render). The matching level stays the measured take's (predictTone). Deterministic: on equal gain the smaller
 * move, then the earlier band, wins.
 * A band whose shape moved (`curves` against `was`, the curves `cells` was measured with) counts by how far its whole
 * curve is from where the chain had it (EqCurves.movedDb): at least EQ_MIN_MOVE_DB, at most its `capDb`, and its
 * gain must sit inside the range of its new place (a cut it carried is not taken along onto a band that may not be cut).
 */
export function planTone(curves: EqCurves, cells: ArrayLike<number>, current: readonly number[], rho: readonly number[], t: TuneTargets, totalDb: number, was: EqCurves = curves): number[] {
  return solvePlan(curves, cells, current, rho, t, totalDb, was).gains
}

/** A plan: the curves (band shapes) and the gain of each band. */
export interface TonePlan {
  curves: EqCurves
  gains: number[]
}

/**
 * planTone, and then the bands' shapes: while the gains alone leave SHAPE_MIN_EXCESS_DB of weighted excess, the one
 * shape move (`variants(i, bands)`: handle `i` at another frequency / width, for the BANDS indexes still out) whose
 * re-solved plan costs the least is taken, when it beats the plan so far by more than SHAPE_COST; at most MAX_SHAPED
 * bands. `was` and `current` are the curves and gains `cells` was measured with. Deterministic.
 */
export function planShaped(
  was: EqCurves,
  cells: ArrayLike<number>,
  current: readonly number[],
  rho: readonly number[],
  t: TuneTargets,
  totalDb: number,
  variants: (i: number, bands: readonly number[]) => readonly EqHandle[],
): TonePlan {
  let best = { curves: was, ...solvePlan(was, cells, current, rho, t, totalDb, was) }
  const level = toneLevel(bandsOfCells(cells), t.style)
  const shapedCost = (c: EqCurves): number => SHAPE_COST * c.handles.filter((h) => !sameShape(h)).length
  const done = new Set<number>()
  for (let round = 0; round < MAX_SHAPED; round++) {
    const left = toneExcess(predictTone(cells, best.curves.delta(current, best.gains, rho, was), t, level), t)
    const bands = left
      .map((e, b) => ({ e: e * t.weight[b], b }))
      .filter((x) => x.e > 0)
      .sort((x, y) => y.e - x.e || x.b - y.b)
    if (bands.reduce((s, x) => s + x.e, 0) < SHAPE_MIN_EXCESS_DB) break
    const want = bands.slice(0, 3).map((x) => x.b)
    let pick: (TonePlan & { cost: number; i: number }) | null = null
    let bar = best.cost + shapedCost(best.curves) - 1e-9
    for (let i = 0; i < was.handles.length; i++) {
      if (done.has(i)) continue
      for (const h of variants(i, want)) {
        const curves = best.curves.with(i, h)
        const r = solvePlan(curves, cells, current, rho, t, totalDb, was)
        const moved = curves.movedDb(i, r.gains[i])
        if (!Number.isFinite(r.cost) || moved > h.capDb + 1e-9 || moved < EQ_MIN_MOVE_DB) continue
        const cost = r.cost + shapedCost(curves)
        if (cost < bar - 1e-9) {
          bar = cost
          pick = { curves, gains: r.gains, cost: r.cost, i }
        }
      }
    }
    if (!pick) break
    done.add(pick.i)
    best = pick
  }
  return { curves: best.curves, gains: best.gains }
}

function solvePlan(curves: EqCurves, cells: ArrayLike<number>, current: readonly number[], rho: readonly number[], t: TuneTargets, totalDb: number, was: EqCurves): { gains: number[]; cost: number } {
  const hs = curves.handles
  const g = current.slice()
  const moved = (gains: readonly number[]): number => gains.reduce((s, v, i) => s + curves.movedDb(i, v), 0)
  const level = toneLevel(bandsOfCells(cells), t.style)
  const now = toneExcess(toneAt(bandsOfCells(cells), t.style, level), t)
  /** A band whose shape moved must sit inside the range of its new place and inside its cap, whatever gain it came with. */
  const fits = (i: number, v: number): boolean => sameShape(hs[i]) || (v >= hs[i].lo - 1e-9 && v <= hs[i].hi + 1e-9 && curves.movedDb(i, v) <= hs[i].capDb + 1e-9)
  const cost = (gains: readonly number[]): number => {
    if (gains.some((v, i) => !fits(i, v))) return Infinity
    const tone = predictTone(cells, curves.delta(current, gains, rho, was), t, level)
    const real = toneExcess(tone, t)
    if (real.some((e, i) => t.weight[i] > 0 && e > now[i] + PLAN_WORSEN_MAX_DB)) return Infinity
    const pushed = real.reduce((s, e, i) => s + t.weight[i] * Math.max(0, e - now[i]), 0)
    return toneExcess(tone, t, AIM_MARGIN_DB).reduce((s, e, i) => s + t.weight[i] * e, 0) + (WORSEN_WEIGHT - 1) * pushed + MOVE_COST * moved(gains)
  }
  const need = toneExcess(toneAt(bandsOfCells(cells), t.style, level), t, AIM_MARGIN_DB)
  const options = hs.map((h, i) => {
    const reach = curves.reaches(i)
    const room = NEED_FACTOR * need.reduce((m, e, b) => (reach[b] && t.weight[b] > 0 ? Math.max(m, e) : m), 0)
    const set = new Set<number>([h.base, current[i]])
    for (let v = Math.ceil(h.lo / EQ_GRID_DB) * EQ_GRID_DB; v <= h.hi + 1e-9; v += EQ_GRID_DB) {
      if (curves.movedDb(i, r05(v)) >= EQ_MIN_MOVE_DB && Math.abs(r05(v) - current[i]) <= room + 1e-9) set.add(r05(v))
    }
    if (!sameShape(h) && h.lo <= 0 && h.hi >= 0) set.add(0)
    return [...set].filter((v) => fits(i, v)).sort((x, y) => curves.movedDb(i, x) - curves.movedDb(i, y) || x - y)
  })
  // a band whose shape moved may start out of bounds (its old gain at the new place): it comes inside first
  hs.forEach((_h, i) => {
    if (fits(i, g[i]) || !options[i].length) return
    g[i] = options[i].reduce((a, v) => (Math.abs(v - current[i]) < Math.abs(a - current[i]) ? v : a))
  })
  let best = cost(g)
  for (let step = 0; step < 64; step++) {
    let gain = 1e-9
    let pick: [number, number] | null = null
    hs.forEach((_h, i) => {
      for (const v of options[i]) {
        if (v === g[i]) continue
        const trial = g.slice()
        trial[i] = v
        if (moved(trial) > totalDb + 1e-9 && curves.movedDb(i, v) > curves.movedDb(i, g[i])) continue
        const c = cost(trial)
        const won = Number.isFinite(best) ? best - c : Number.isFinite(c) ? Infinity : 0
        if (won > gain + 1e-9) {
          gain = won
          pick = [i, v]
        }
      }
    })
    if (!pick) break
    g[pick[0]] = pick[1]
    best = cost(g)
  }
  return { gains: g, cost: moved(g) > totalDb + 1e-9 ? Infinity : best }
}

/**
 * How much of its nominal curve each moved band really produced, from two renders: least squares of the measured
 * change per cell (80 Hz – 16 kHz, cells with speech in them) on the bands' nominal changes plus one constant (a
 * compressor after the EQ shifts the whole level), each strength pulled gently toward 1. 1 = as the curve says,
 * 0 = the band did nothing, kept within 0..2. Bands that did not move keep `prev`. `was`: the curves (band shapes)
 * the `from` gains and the `before` render belong to, when a band's shape moved too.
 */
export function calibrate(
  curves: EqCurves,
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  from: readonly number[],
  to: readonly number[],
  prev: readonly number[],
  was: EqCurves = curves,
): number[] {
  const reshaped = (i: number): boolean => curves.handles[i].freqHz !== was.handles[i].freqHz || curves.handles[i].bwOct !== was.handles[i].bwOct
  const movedIdx = curves.handles.map((_, i) => i).filter((i) => Math.abs(to[i] - from[i]) >= EQ_GRID_DB / 2 || reshaped(i))
  const rho = prev.slice()
  if (!movedIdx.length) return rho
  let top = 0
  for (let c = CELLS_PER_BAND; c < N_CELLS; c++) if (before[c] > top) top = before[c]
  const rows: number[] = []
  for (let c = CELLS_PER_BAND; c < N_CELLS; c++) if (before[c] > top * 1e-6 && after[c] > 0) rows.push(c)
  if (rows.length < movedIdx.length + 2) return rho

  const u = movedIdx.map((i) => {
    const a = was.curve(i, from[i])
    const b = curves.curve(i, to[i])
    return rows.map((c) => b[c] - a[c])
  })
  const y = rows.map((c) => 10 * Math.log10(after[c] / before[c]))
  // unknowns: [constant, strength of each moved band]
  const n = movedIdx.length + 1
  const col = (j: number, r: number): number => (j === 0 ? 1 : u[j - 1][r])
  const A = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0))
  for (let r = 0; r < rows.length; r++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) A[j][k] += col(j, r) * col(k, r)
      A[j][n] += col(j, r) * y[r]
    }
  }
  for (let j = 1; j < n; j++) {
    const pull = RIDGE * u[j - 1].reduce((s, v) => s + v * v, 0) + 1e-9
    A[j][j] += pull
    A[j][n] += pull
  }
  const x = solve(A)
  if (!x) return rho
  movedIdx.forEach((i, j) => {
    rho[i] = Math.min(RHO_MAX, Math.max(0, x[j + 1]))
  })
  return rho
}

/** Gaussian elimination with partial pivoting on an augmented matrix; null when singular. */
function solve(A: number[][]): number[] | null {
  const n = A.length
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r
    if (Math.abs(A[p][i]) < 1e-12) return null
    ;[A[i], A[p]] = [A[p], A[i]]
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i]
      for (let k = i; k <= n; k++) A[r][k] -= f * A[i][k]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i][n]
    for (let k = i + 1; k < n; k++) s -= A[i][k] * x[k]
    x[i] = s / A[i][i]
  }
  return x.every(Number.isFinite) ? x : null
}
