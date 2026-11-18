// Test-only: a live chain that answers the calibration's commands (the screen's chain state in miniature: one entry per
// target, a revert puts the value from before back) and processes a synthetic mic stream as the engine would send it.
// Effects answer in the right direction only: a block noise remover (silent pauses from strength 10, quiet syllables
// eaten at high strengths, needs time after a change), a ReaFIR that takes 4.5 dB off the room, a block ReaGate.
import { withChange } from '../advice/chain'
import type { ChainSlot, Change } from '../advice/types'
import type { CalCommand, CalStreamFrame } from './types'

const SR = 48000
export const FRAME = 4800

const amp = (db: number): number => (db <= -100 ? 0 : 10 ** (db / 20))
const rmsDb = (x: Float32Array, a: number, b: number): number => {
  let s = 0
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return 10 * Math.log10(s / Math.max(1, b - a) + 1e-20)
}

/** Deterministic white noise, `db` RMS. */
export function noise(n: number, db: number, seed = 1): Float32Array {
  let s = seed >>> 0 || 1
  const a = amp(db) * Math.sqrt(3)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    out[i] = (s / 4294967296 - 0.5) * 2 * a
  }
  return out
}

/**
 * Speech over the room: syllables (two harmonics) of `speechDb` RMS, every fourth one `quietDb` (the quiet syllables
 * a remover or a gate eats first), 40 ms fades, gaps of 120 ms and a pause of 500 ms every 6 syllables.
 */
export function speech(sec: number, roomDb: number, speechDb = roomDb + 15, quietDb = speechDb - 7, seed = 7): Float32Array {
  const n = Math.round(sec * SR)
  const x = noise(n, roomDb, seed)
  const fade = Math.round(0.04 * SR)
  let t = Math.round(0.2 * SR)
  for (let k = 0; t < n; k++) {
    const len = Math.round(0.22 * SR)
    const g = amp(k % 4 === 3 ? quietDb : speechDb) * Math.SQRT2 * 0.9
    const f0 = 130 + (k % 5) * 9
    for (let i = 0; i < len && t + i < n; i++) {
      const w = Math.min(1, i / fade, (len - i) / fade)
      x[t + i] += g * w * (0.8 * Math.sin((2 * Math.PI * f0 * i) / SR) + 0.45 * Math.sin((4 * Math.PI * f0 * i) / SR))
    }
    t += len + Math.round((k % 6 === 5 ? 0.5 : 0.12) * SR)
  }
  return x
}

export interface FakeLiveOptions {
  /** The room on the raw mic (the remover's idea of it), dBFS. */
  roomDb: number
  /** A Noise Removal change is heard this long after it was sent (stream time), ms. */
  nrFollowMs?: number
  /** Strength from which the remover eats the quiet syllables' starts (dB over the room it closes under grows with it). */
  chopFrom?: number
}

/** The live chain the calibration drives, and the engine stream it hears. */
export class FakeLive {
  private entries = new Map<string, Change>()
  private heard: ChainSlot[]
  private pendingNr: { at: number; slot: ChainSlot } | null = null
  private seq = 0
  private t = 0
  private gateOpen = 0
  readonly log: CalCommand[] = []

  constructor(
    readonly base: readonly ChainSlot[],
    readonly opts: FakeLiveOptions,
  ) {
    this.heard = [...base]
  }

  /** The chain with every calibration entry applied. */
  get chain(): ChainSlot[] {
    return [...this.entries.values()].reduce<ChainSlot[]>((c, x) => withChange(c, x), [...this.base])
  }

  /** Applies the calibration's commands (as the screen's chain state does); a Noise Removal follows nrFollowMs later. */
  apply(cmds: readonly CalCommand[]): void {
    if (!cmds.length) return
    this.log.push(...cmds)
    for (const c of cmds) {
      if (c.kind === 'set') this.entries.set(c.target, c.change)
      else this.entries.delete(c.target)
    }
    for (const s of this.chain) {
      const h = this.heard.find((x) => x.index === s.index)
      if (s.kind !== 'noiseRemoval') this.heard = this.heard.map((x) => (x.index === s.index ? s : x))
      else if (JSON.stringify(h) !== JSON.stringify(s)) this.pendingNr = { at: this.t + (this.opts.nrFollowMs ?? 500), slot: s }
    }
  }

  /** One stream frame: `raw` (FRAME samples) through the chain as it is heard now. */
  frame(raw: Float32Array, extra: Partial<CalStreamFrame> = {}): CalStreamFrame {
    const p = this.pendingNr
    if (p && this.t >= p.at) {
      this.heard = this.heard.map((x) => (x.index === p.slot.index ? p.slot : x))
      this.pendingNr = null
    }
    const out = raw.slice()
    for (const s of this.heard) if (s.on) this.process(s, raw, out)
    this.t += (raw.length / SR) * 1000
    return { seq: this.seq++, sampleRate: SR, settled: true, latencyChanged: false, counters: { streamDropped: 0, inputOverruns: 0 }, raw, processed: out, ...extra }
  }

  private process(s: ChainSlot, raw: Float32Array, x: Float32Array): void {
    const w = Math.round(0.01 * SR)
    const room = this.opts.roomDb
    if (s.kind === 'noiseRemoval') {
      const st = s.values.strength ?? 0
      // closes under room + 3 dB, plus 0.6 dB per point past chopFrom (quiet syllables go first)
      const close = room + 3 + Math.max(0, st - (this.opts.chopFrom ?? 30)) * 0.6
      const g = st >= 10 ? 0 : amp(-10 - 3 * st)
      for (let b = 0; b + w <= x.length; b += w) if (rmsDb(raw, b, b + w) < close) for (let i = b; i < b + w; i++) x[i] *= g
    } else if (s.kind === 'reafir') {
      for (let b = 0; b + w <= x.length; b += w) if (rmsDb(raw, b, b + w) < room + 3) for (let i = b; i < b + w; i++) x[i] *= amp(-4.5)
    } else if (s.kind === 'reagate') {
      const v = s.values
      const hold = Math.round(((v.holdMs ?? 0) / 1000) * SR)
      const open = amp(v.wetDb) + amp(v.dryDb)
      const closed = amp(v.dryDb)
      const g5 = Math.round(0.005 * SR)
      for (let b = 0; b < x.length; b += g5) {
        let p = 0
        for (let i = b; i < Math.min(x.length, b + g5); i++) p = Math.max(p, Math.abs(x[i]))
        if (20 * Math.log10(p + 1e-12) > v.thresholdDb) this.gateOpen = hold + g5
        const gain = this.gateOpen > 0 ? open : closed
        for (let i = b; i < Math.min(x.length, b + g5); i++) x[i] *= gain
        this.gateOpen -= g5
      }
    } else if (s.kind === 'reacomp') {
      const g = amp(s.values.wetDb ?? 0)
      for (let i = 0; i < x.length; i++) x[i] *= g
    }
  }
}

/** Cuts a signal into stream frames. */
export function framesOf(x: Float32Array): Float32Array[] {
  const out: Float32Array[] = []
  for (let k = 0; (k + 1) * FRAME <= x.length; k++) out.push(x.slice(k * FRAME, (k + 1) * FRAME))
  return out
}
