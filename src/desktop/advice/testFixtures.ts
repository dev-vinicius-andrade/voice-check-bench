// Test-only builders for advice tests: held metrics and a guide-like live chain.
import type { HeldMetrics, HeldSide } from '../../live/hold'
import { eqValues, type EqBandView } from './chain'
import type { ChainSlot } from './types'

/** Processed side heard just now: speech in the good range, no clipping, no dead silence, tone on the goal. */
export const heldSide = (p: Partial<HeldSide> = {}): HeldSide => ({
  speechDb: -21,
  peakDb: -8,
  clipFrames: 0,
  pauseDb: -65,
  deadSilence: 0,
  tone: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  heardAtMs: 1000,
  heardAgoMs: 0,
  ...p,
})

export const held = (fx: Partial<HeldSide> = {}): HeldMetrics => ({ talkSec: 3, raw: null, fx: heldSide(fx), lagMs: null, sync: 0, hints: [] })

/** Tone with deviations at BANDS indexes. */
export const tone = (devs: Record<number, number>): number[] => Array.from({ length: 9 }, (_, i) => devs[i] ?? 0)

export const noiseRemoval = (strength = 85, on = true): ChainSlot => ({ index: 0, kind: 'noiseRemoval', name: 'Elgato Noise Removal', on, values: { strength } })
export const gate = (v: Partial<Record<'thresholdDb' | 'wetDb' | 'dryDb', number>> = {}, on = true): ChainSlot => ({
  index: 1,
  kind: 'reagate',
  name: 'ReaGate (ReaPlugs Edition)',
  on,
  values: { thresholdDb: -50, holdMs: 150, releaseMs: 200, wetDb: 0, dryDb: -20, ...v },
})
export const eq = (bands: readonly Omit<EqBandView, 'n'>[] = GUIDE_BANDS, on = true): ChainSlot => ({ index: 2, kind: 'reaeq', name: 'ReaEQ (ReaPlugs Edition)', on, values: eqValues(bands) })
export const comp = (wetDb = 6, on = true, index = 3): ChainSlot => ({
  index,
  kind: 'reacomp',
  name: 'ReaComp (ReaPlugs Edition)',
  on,
  values: { thresholdDb: -30, ratio: 3, attackMs: 5, releaseMs: 100, wetDb },
})

/** The guide's ReaEQ bands, flat. */
export const GUIDE_BANDS: readonly Omit<EqBandView, 'n'>[] = [
  { type: 'Low Shelf', on: true, freqHz: 150, gainDb: 0, bwOct: 2 },
  { type: 'Band', on: true, freqHz: 250, gainDb: 0, bwOct: 1.5 },
  { type: 'Band', on: true, freqHz: 450, gainDb: 0, bwOct: 1.2 },
  { type: 'Band', on: true, freqHz: 3500, gainDb: 0, bwOct: 1.4 },
  { type: 'High Shelf', on: true, freqHz: 10000, gainDb: 0, bwOct: 2 },
]

/** Noise Removal → ReaGate → ReaEQ → ReaComp, all on. */
export const chain = (): ChainSlot[] => [noiseRemoval(), gate(), eq(), comp()]
