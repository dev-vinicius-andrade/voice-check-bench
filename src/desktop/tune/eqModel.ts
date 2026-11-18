// The tuner's EQ model. Pure.
// It plans ReaEQ gain moves from the take's own measured speech spectrum and each band's nominal curve
// (src/audio/eqCurve.ts), then corrects itself from a render: calibrate() fits how much of its nominal curve each
// moved band REALLY produced in the rendered audio, and the next plan uses that. A band that does nothing where the
// voice needs it (a 10 kHz shelf for a 5–10 kHz problem) therefore stops being moved.
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
}

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
      })
    }
  }
  return out
}

/** Nominal curves of the handles at the cell centres, cached per gain. */
export class EqCurves {
  private readonly cache = new Map<string, Float64Array>()
  constructor(
    readonly handles: readonly EqHandle[],
    private readonly cellHz: readonly number[],
    private readonly sampleRate: number,
  ) {}

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

  /** Predicted change per cell, dB, when the gains go from `from` to `to`, each band scaled by its fitted strength. */
  delta(from: readonly number[], to: readonly number[], rho: readonly number[]): Float64Array {
    const d = new Float64Array(N_CELLS)
    this.handles.forEach((_, i) => {
      if (to[i] === from[i]) return
      const a = this.curve(i, from[i])
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

  /** Mean change of each BANDS entry, dB, when only handle `i` goes from `from` to `to`. */
  bandDelta(i: number, from: number, to: number): number[] {
    const a = this.curve(i, from)
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
 */
export function planTone(curves: EqCurves, cells: ArrayLike<number>, current: readonly number[], rho: readonly number[], t: TuneTargets, totalDb: number): number[] {
  const hs = curves.handles
  const g = current.slice()
  const moved = (gains: readonly number[]): number => gains.reduce((s, v, i) => s + Math.abs(v - hs[i].base), 0)
  const level = toneLevel(bandsOfCells(cells), t.style)
  const now = toneExcess(toneAt(bandsOfCells(cells), t.style, level), t)
  const cost = (gains: readonly number[]): number => {
    const tone = predictTone(cells, curves.delta(current, gains, rho), t, level)
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
      if (Math.abs(r05(v) - h.base) >= EQ_MIN_MOVE_DB && Math.abs(r05(v) - current[i]) <= room + 1e-9) set.add(r05(v))
    }
    return [...set].sort((x, y) => Math.abs(x - h.base) - Math.abs(y - h.base) || x - y)
  })
  let best = cost(g)
  for (let step = 0; step < 64; step++) {
    let gain = 1e-9
    let pick: [number, number] | null = null
    hs.forEach((h, i) => {
      for (const v of options[i]) {
        if (v === g[i]) continue
        const trial = g.slice()
        trial[i] = v
        if (moved(trial) > totalDb + 1e-9 && Math.abs(v - h.base) > Math.abs(g[i] - h.base)) continue
        const won = best - cost(trial)
        if (won > gain + 1e-9) {
          gain = won
          pick = [i, v]
        }
      }
    })
    if (!pick) break
    g[pick[0]] = pick[1]
    best -= gain
  }
  return g
}

/**
 * How much of its nominal curve each moved band really produced, from two renders: least squares of the measured
 * change per cell (80 Hz – 16 kHz, cells with speech in them) on the bands' nominal changes plus one constant (a
 * compressor after the EQ shifts the whole level), each strength pulled gently toward 1. 1 = as the curve says,
 * 0 = the band did nothing, kept within 0..2. Bands that did not move keep `prev`.
 */
export function calibrate(
  curves: EqCurves,
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  from: readonly number[],
  to: readonly number[],
  prev: readonly number[],
): number[] {
  const movedIdx = curves.handles.map((_, i) => i).filter((i) => Math.abs(to[i] - from[i]) >= EQ_GRID_DB / 2)
  const rho = prev.slice()
  if (!movedIdx.length) return rho
  let top = 0
  for (let c = CELLS_PER_BAND; c < N_CELLS; c++) top = Math.max(top, before[c])
  const rows: number[] = []
  for (let c = CELLS_PER_BAND; c < N_CELLS; c++) if (before[c] > top * 1e-6 && after[c] > 0) rows.push(c)
  if (rows.length < movedIdx.length + 2) return rho

  const u = movedIdx.map((i) => {
    const a = curves.curve(i, from[i])
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
