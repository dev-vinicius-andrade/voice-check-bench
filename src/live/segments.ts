// Live segments (SPEC "Live tuning (v1.3)"): a segment starts at Start and at every markChange ("I changed something")
// and sums up its whole duration, not just the 4 s window. Framework-free, no browser APIs: it is fed the frames of each
// window (liveFrames) and the absolute sample where the window ends, and consumes only the frames it has not seen, so
// overlapping windows are never counted twice. Memory per side is fixed (level histograms, band sums, counters); closed
// segments keep only their numbers.
import { FLOOR_DB } from '../audio/analyze'
import { BANDS, targetDeviations } from '../audio/reference'
import type { Msg } from '../plain/types'
import type { VoiceGoal } from '../types'
import { addFramePower, bandEnergies, FRAME_SEC, MIN_PAUSE_SEC, MIN_TALK_SEC, relBands, specScratch, ZeroRuns, type LiveFrames, type SpecScratch } from './frames'

/** Label of the segment that begins at Start. */
export const START_LABEL: Msg = { key: 'live.segment.start' }
/** Closed segments kept (the oldest are dropped); sinceStart() still covers everything. */
export const MAX_SEGMENTS = 100
/** Frame-level histogram: HIST_STEP dB bins from FLOOR_DB up to FLOOR_DB + (HIST_BINS − 1)·HIST_STEP (+20 dBFS). */
export const HIST_STEP = 0.1
export const HIST_BINS = 1201

export interface SegmentSide {
  /** Median talk-frame level, dBFS (NaN without talk). */
  speechDb: number
  /** Median pause-frame level, dBFS (NaN under MIN_PAUSE_SEC of pauses). */
  pauseDb: number
  clipFrames: number
  /** Share of the segment's samples in exact-zero runs, 0..1. */
  deadSilence: number
  /** Deviation from the goal per BANDS entry over all talk frames, dB (NaN under MIN_TALK_SEC of talk). */
  tone: number[]
}

export interface SegmentSummary {
  /** Times on the caller's clock, ms. */
  startT: number
  endT: number
  label: Msg
  talkSec: number
  raw: SegmentSide | null
  fx: SegmentSide
}

/** Bounded stand-in for an array of frame levels: median within HIST_STEP / 2. */
class LevelHistogram {
  readonly counts = new Uint32Array(HIST_BINS)
  n = 0
  add(db: number): void {
    const i = Math.min(HIST_BINS - 1, Math.max(0, Math.round((db - FLOOR_DB) / HIST_STEP)))
    this.counts[i]++
    this.n++
  }
  private at(rank: number): number {
    let c = 0
    for (let i = 0; i < HIST_BINS; i++) {
      c += this.counts[i]
      if (c > rank) return FLOOR_DB + i * HIST_STEP
    }
    return NaN
  }
  /** Linear-interpolated median, as dsp.median. */
  median(): number {
    if (!this.n) return NaN
    const r = (this.n - 1) * 0.5
    const lo = this.at(Math.floor(r))
    return lo + (this.at(Math.ceil(r)) - lo) * (r - Math.floor(r))
  }
}

interface FrozenSide {
  speechDb: number
  pauseDb: number
  pauseFrames: number
  clipFrames: number
  deadSilence: number
  bands: number[]
}

class SideAcc {
  readonly speech = new LevelHistogram()
  readonly pause = new LevelHistogram()
  readonly bands = new Float64Array(BANDS.length)
  readonly zeros: ZeroRuns
  clipFrames = 0
  constructor(sampleRate: number) {
    this.zeros = new ZeroRuns(sampleRate)
  }
  freeze(): FrozenSide {
    return {
      speechDb: this.speech.median(),
      pauseDb: this.pause.median(),
      pauseFrames: this.pause.n,
      clipFrames: this.clipFrames,
      deadSilence: this.zeros.ratio,
      bands: Array.from(this.bands),
    }
  }
  get bytes(): number {
    return this.speech.counts.byteLength + this.pause.counts.byteLength + this.bands.byteLength
  }
}

class SegmentAcc {
  talkFrames = 0
  raw: SideAcc | null = null
  fx: SideAcc | null = null
  endT: number
  constructor(
    readonly startT: number,
    readonly label: Msg,
  ) {
    this.endT = startT
  }
}

interface Frozen {
  startT: number
  endT: number
  label: Msg
  talkFrames: number
  raw: FrozenSide | null
  fx: FrozenSide | null
}

const freeze = (s: SegmentAcc): Frozen => ({ startT: s.startT, endT: s.endT, label: s.label, talkFrames: s.talkFrames, raw: s.raw?.freeze() ?? null, fx: s.fx?.freeze() ?? null })

const NO_SIDE: FrozenSide = { speechDb: NaN, pauseDb: NaN, pauseFrames: 0, clipFrames: 0, deadSilence: 0, bands: BANDS.map(() => 0) }

function sideSummary(s: FrozenSide, talkSec: number, goal: VoiceGoal): SegmentSide {
  return {
    speechDb: s.speechDb,
    pauseDb: s.pauseFrames * FRAME_SEC >= MIN_PAUSE_SEC - 1e-9 ? s.pauseDb : NaN,
    clipFrames: s.clipFrames,
    deadSilence: s.deadSilence,
    tone: talkSec >= MIN_TALK_SEC ? targetDeviations(relBands(s.bands), goal) : BANDS.map(() => NaN),
  }
}

function summary(f: Frozen, goal: VoiceGoal): SegmentSummary {
  const talkSec = f.talkFrames * FRAME_SEC
  return {
    startT: f.startT,
    endT: f.endT,
    label: f.label,
    talkSec,
    raw: f.raw ? sideSummary(f.raw, talkSec, goal) : null,
    fx: sideSummary(f.fx ?? NO_SIDE, talkSec, goal),
  }
}

export class LiveSegments {
  private closed: Frozen[] = []
  private open: SegmentAcc
  private all: SegmentAcc
  /** Absolute sample just after the last frame consumed; null before the first feed. */
  private fedEnd: number | null = null
  private scratch: SpecScratch | null = null
  private scratchWin = 0
  private spec = new Float64Array(0)

  constructor(t = 0) {
    this.open = new SegmentAcc(t, START_LABEL)
    this.all = new SegmentAcc(t, START_LABEL)
  }

  /** Forgets everything; the first segment starts at t (Start). */
  reset(t = 0): void {
    this.closed = []
    this.open = new SegmentAcc(t, START_LABEL)
    this.all = new SegmentAcc(t, START_LABEL)
    this.fedEnd = null
  }

  /** Closes the current segment at t and opens a new one labelled `label`. */
  markChange(label: Msg, t: number): void {
    this.open.endT = Math.max(this.open.endT, t)
    this.closed.push(freeze(this.open))
    if (this.closed.length > MAX_SEGMENTS) this.closed.shift()
    this.open = new SegmentAcc(t, label)
  }

  /**
   * Adds the frames of a window that ends at absolute sample `endSample` (the end of the aligned stretch, fx time) at
   * time t. Frames that start before the end of the previous feed were already counted and are skipped.
   */
  feed(fr: LiveFrames, endSample: number, t: number): void {
    this.open.endT = Math.max(this.open.endT, t)
    this.all.endT = Math.max(this.all.endT, t)
    const { win, nF, off } = fr
    const first = endSample - nF * win
    const k0 = this.fedEnd === null ? 0 : Math.max(0, Math.ceil((this.fedEnd - first) / win))
    if (k0 >= nF) return
    const contiguous = this.fedEnd !== null && first + k0 * win === this.fedEnd
    this.fedEnd = endSample
    const accs = [this.open, this.all]
    const sides = (['raw', 'fx'] as const).flatMap((k) => {
      const x = fr[k]
      const frames = k === 'raw' ? fr.rawFrames : fr.fxFrames
      if (!x || !frames) return []
      return [{ x, frames, accs: accs.map((a) => (a[k] ??= new SideAcc(fr.sampleRate))) }]
    })
    if (!this.scratch || this.scratchWin !== win) {
      this.scratch = specScratch(win)
      this.scratchWin = win
      this.spec = new Float64Array(this.scratch.n / 2 + 1)
    }
    const sc = this.scratch
    for (let f = k0; f < nF; f++) {
      const talk = fr.talk[f] === 1
      if (talk) for (const a of accs) a.talkFrames++
      for (const s of sides) {
        const level = s.frames.levels[f]
        let e: number[] | null = null
        if (talk) {
          this.spec.fill(0)
          addFramePower(s.x, off + f * win, sc, this.spec)
          e = bandEnergies(this.spec, fr.sampleRate, sc.n)
        }
        for (const a of s.accs) {
          if (talk) a.speech.add(level)
          else if (fr.pause[f]) a.pause.add(level)
          if (s.frames.clip[f]) a.clipFrames++
          if (e) for (let b = 0; b < e.length; b++) a.bands[b] += e[b]
        }
      }
    }
    for (const s of sides) {
      const fresh = s.x.subarray(off + k0 * win, off + nF * win)
      for (const a of s.accs) {
        if (!contiguous) a.zeros.cut()
        a.zeros.push(fresh)
      }
    }
  }

  /** Every segment kept, oldest first, the current one last. */
  segments(goal: VoiceGoal): SegmentSummary[] {
    return [...this.closed.map((f) => summary(f, goal)), summary(freeze(this.open), goal)]
  }

  /** Everything since Start, as one segment. */
  sinceStart(goal: VoiceGoal): SegmentSummary {
    return summary(freeze(this.all), goal)
  }

  /** Bytes held by the running accumulators plus the number of closed segments (for tests: memory stays bounded). */
  footprint(): { accBytes: number; closed: number } {
    const accBytes = [this.open, this.all].reduce((n, a) => n + (a.raw?.bytes ?? 0) + (a.fx?.bytes ?? 0), 0)
    return { accBytes, closed: this.closed.length }
  }
}
