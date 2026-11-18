// Test-only: a small deterministic stand-in for the real plugin chain. Each effect answers in the right direction,
// nothing more: a noise remover and a gate working on short blocks, RBJ biquads for ReaEQ, a feed-forward compressor,
// and a ReaFIR that is a steep low-cut (what the real chain's did to the voice) unless a test gives its own.
import { biquad } from '../../audio/eqCurve'
import { eqBands, withChange } from '../advice/chain'
import type { ChainSlot, Change } from '../advice/types'
import type { TuneRender } from './types'

export interface FakeOptions {
  sampleRate?: number
  /** The gain a ReaEQ band really applies for the gain it is set to (default: as set). Lets a test break a band. */
  eqGain?: (slot: number, band: number, gainDb: number) => number
  /** Extra processing after the chain (a limiter, a broken effect). */
  post?: (x: Float32Array, chain: readonly ChainSlot[]) => void
  /**
   * A Noise Removal that reacts to level, like the real one behind a compressor: dB it takes off 2.5 kHz and up for
   * every dB its input sits over −30 dBFS RMS (0 = it does not react, the default).
   */
  removerReactsDb?: number
  /** What a switched-on ReaFIR does (default: lowCut at REAFIR_CUT_HZ). */
  reafir?: (x: Float32Array, sampleRate: number) => void
  /**
   * A Noise Removal that lets the room through for a moment in the middle of a pause, like the real one when the room
   * it receives sits near its threshold: room blocks over this level (dBFS RMS), LEAK_AFTER_MS or more after the last
   * voice block, pass untouched for LEAK_MS of every LEAK_EVERY_MS (off by default). With it the remover also tells the
   * voice by its level, as a voice detector would: a block LEAK_VOICE_DB or more under the loudest blocks (P90) is room,
   * however far over the room it learned (a gate opening on the room is no voice).
   */
  removerLeaksAboveDb?: number
}

/** The fake remover's leak: this long, this often, from this long into a pause, ms. */
export const LEAK_MS = 60
export const LEAK_EVERY_MS = 500
export const LEAK_AFTER_MS = 400
export const LEAK_VOICE_DB = 18

/** Corner of the default fake ReaFIR's low-cut, Hz: it empties 80–160 Hz and leaves 160–320 Hz. */
export const REAFIR_CUT_HZ = 170

/** A 24 dB / octave high-pass (two RBJ biquads), in place. */
export function lowCut(x: Float32Array, sr: number, hz: number): void {
  const w = (2 * Math.PI * hz) / sr
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / Math.SQRT2
  const b0 = (1 + cos) / 2 / (1 + alpha)
  const b1 = -(1 + cos) / (1 + alpha)
  const a1 = (-2 * cos) / (1 + alpha)
  const a2 = (1 - alpha) / (1 + alpha)
  for (let pass = 0; pass < 2; pass++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < x.length; i++) {
      const x0 = x[i]
      const y0 = b0 * x0 + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x0
      y2 = y1
      y1 = y0
      x[i] = y0
    }
  }
}

const amp = (db: number): number => (db <= -100 ? 0 : 10 ** (db / 20))
const dbOf = (v: number): number => 20 * Math.log10(v + 1e-12)

function blockRms(x: Float32Array, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

/**
 * Noise remover: learns the room from the first two seconds (median 10 ms block level). Blocks within a margin of
 * it (2 dB at strength 0, 10 dB at 100) are turned down by 0.45 dB per point of strength; from 80 they become exact
 * zeros (the real one gates pauses to digital silence at its default 85). High strengths therefore also eat quiet
 * syllables.
 */
function noiseRemoval(x: Float32Array, sr: number, strength: number, leakDb?: number): void {
  const w = Math.round(0.01 * sr)
  const lead: number[] = []
  for (let s = 0; s + w <= Math.min(x.length, 2 * sr); s += w) lead.push(blockRms(x, s, s + w))
  lead.sort((p, q) => p - q)
  const room = lead[Math.floor(lead.length / 2)] ?? 0
  const leak = leakDb === undefined ? Infinity : amp(leakDb)
  const blocks: number[] = []
  if (leakDb !== undefined) for (let s = 0; s + w <= x.length; s += w) blocks.push(blockRms(x, s, s + w))
  blocks.sort((p, q) => p - q)
  const voiceFloor = leakDb === undefined ? 0 : (blocks[Math.floor(0.9 * blocks.length)] ?? 0) * 10 ** (-LEAK_VOICE_DB / 20)
  const thr = Math.max(room * 10 ** ((2 + 0.08 * strength) / 20), voiceFloor)
  const g = strength >= 80 ? 0 : 10 ** ((-0.45 * strength) / 20)
  let voice = -Infinity
  for (let s = 0; s < x.length; s += w) {
    const end = Math.min(x.length, s + w)
    const rms = blockRms(x, s, end)
    if (rms >= thr) voice = s
    const ms = (s / sr) * 1000
    if (rms >= thr || (rms > leak && ms - (voice / sr) * 1000 >= LEAK_AFTER_MS && ms % LEAK_EVERY_MS < LEAK_MS)) continue
    for (let i = s; i < end; i++) x[i] *= g
  }
}

/** The level-reactive part of a remover: a high shelf at 2.5 kHz cut by `perDb` for every dB the input RMS is over −30 dBFS (at most 12 dB). */
function reactiveTilt(x: Float32Array, sr: number, perDb: number): void {
  const over = Math.max(0, dbOf(blockRms(x, 0, x.length)) + 30)
  const c = biquad({ type: 'High Shelf', freq: 2500, gain: -Math.min(12, perDb * over), bw: 2 }, sr)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]
    const y0 = (c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2) / c.a0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
    x[i] = y0
  }
}

/** ReaGate: open while 5 ms blocks are above the threshold, plus the hold; output = input × (Wet when open + Dry). */
function gate(x: Float32Array, sr: number, v: Record<string, number>): void {
  const w = Math.round(0.005 * sr)
  const thr = 10 ** (v.thresholdDb / 20)
  const hold = Math.round(((v.holdMs ?? 0) / 1000) * sr)
  const wet = amp(v.wetDb)
  const dry = amp(v.dryDb)
  let openUntil = -1
  for (let s = 0; s < x.length; s += w) {
    const end = Math.min(x.length, s + w)
    if (blockRms(x, s, end) > thr) openUntil = end + hold
    const g = (s < openUntil ? wet : 0) + dry
    for (let i = s; i < end; i++) x[i] *= g
  }
}

function eq(x: Float32Array, sr: number, slot: ChainSlot, eqGain: NonNullable<FakeOptions['eqGain']>): void {
  for (const b of eqBands(slot)) {
    if (!b.on || b.type === 'Other') continue
    const c = biquad({ type: b.type, freq: b.freqHz, gain: eqGain(slot.index, b.n, b.gainDb), bw: b.bwOct }, sr)
    const b0 = c.b0 / c.a0, b1 = c.b1 / c.a0, b2 = c.b2 / c.a0, a1 = c.a1 / c.a0, a2 = c.a2 / c.a0
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < x.length; i++) {
      const x0 = x[i]
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x0
      y2 = y1
      y1 = y0
      x[i] = y0
    }
  }
}

/** ReaComp: peak envelope with attack / release, gain reduction above the threshold by the ratio, then Wet as make-up. */
function comp(x: Float32Array, sr: number, v: Record<string, number>): void {
  const att = Math.exp(-1 / (((v.attackMs ?? 5) / 1000) * sr + 1))
  const rel = Math.exp(-1 / (((v.releaseMs ?? 100) / 1000) * sr + 1))
  const slope = 1 - 1 / Math.max(1, v.ratio ?? 1)
  const makeup = amp(v.wetDb ?? 0)
  let env = 0
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i])
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a
    const over = dbOf(env) - (v.thresholdDb ?? 0)
    x[i] *= (over > 0 ? 10 ** ((-over * slope) / 20) : 1) * makeup
  }
}

/**
 * A render for tune(): the take through the chain with the changes applied on top, clamped to ±1 like a real output.
 * `calls` records every change list it was asked to render.
 */
export function fakeRenderer(take: Float32Array, chain: readonly ChainSlot[], opts: FakeOptions = {}): { render: TuneRender; calls: Change[][] } {
  const sr = opts.sampleRate ?? 48000
  const eqGain = opts.eqGain ?? ((_slot: number, _band: number, g: number): number => g)
  const reafir = opts.reafir ?? ((x: Float32Array, rate: number): void => lowCut(x, rate, REAFIR_CUT_HZ))
  const calls: Change[][] = []
  const render: TuneRender = (changes) => {
    calls.push([...changes])
    const live = changes.reduce<ChainSlot[]>((c, x) => withChange(c, x), [...chain])
    const x = take.slice()
    for (const s of live) {
      if (!s.on) continue
      if (s.kind === 'reafir') reafir(x, sr)
      else if (s.kind === 'noiseRemoval') {
        if (opts.removerReactsDb) reactiveTilt(x, sr, opts.removerReactsDb)
        noiseRemoval(x, sr, s.values.strength ?? 0, opts.removerLeaksAboveDb)
      }
      else if (s.kind === 'reagate') gate(x, sr, s.values)
      else if (s.kind === 'reaeq') eq(x, sr, s, eqGain)
      else if (s.kind === 'reacomp') comp(x, sr, s.values)
    }
    opts.post?.(x, live)
    for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i]))
    return Promise.resolve(x)
  }
  return { render, calls }
}
