// Levels of the live noise calibration (SPEC "Calibrate noise live"). Pure, framework-free. The engine's stream frames
// (raw and processed, aligned) are cut into analyze()'s 50 ms frames; the quiet phases read the room and the pauses
// from them, the talk phase also keeps the samples for the cut check (./talkCheck.ts).
import { FLOOR_DB, SPEECH_MARGINS } from '../../audio/analyze'
import { adb, median, pct } from '../../audio/dsp'
import { BURST_OVER_DB } from '../tune/measure'

/** Frame length of every calibration measurement, seconds (analyze()'s frames, as the tuner's mask). */
export const CAL_FRAME_SEC = 0.05
/** Talking: a frame this far over the room (analyze()'s middle speech margin), dB… */
export const TALK_OVER_ROOM_DB = SPEECH_MARGINS[1]
/** …in this many frames in a row (a click or a breath is one). */
export const TALK_FRAMES = 2
/** Pauses that read this low (or digital silence) are what the person asked for: total silence, dBFS. */
export const PAUSE_SILENT_DB = -65

/** One 50 ms frame: RMS and sample peak of each side, dBFS, floored at FLOOR_DB (digital silence reads FLOOR_DB). */
export interface CalFrameLevels {
  rawDb: number
  rawPeakDb: number
  procDb: number
  procPeakDb: number
}

const floorDb = (v: number): number => Math.max(FLOOR_DB, v)

function levelsOf(x: Float32Array, from: number, to: number): [rms: number, peak: number] {
  let s = 0
  let p = 0
  for (let i = from; i < to; i++) {
    const v = x[i]
    s += v * v
    if (Math.abs(v) > p) p = Math.abs(v)
  }
  return [floorDb(adb(Math.sqrt(s / Math.max(1, to - from)))), floorDb(adb(p))]
}

/** RMS of a whole stream frame, dBFS (the level shown while calibrating). */
export const frameDb = (x: Float32Array): number => levelsOf(x, 0, x.length)[0]

/**
 * Collects a stream into whole 50 ms frames (any frame length in; a partial frame waits for the next push). With
 * `keepSamples`, the samples of the whole frames are kept too (the talk phase's cut check).
 */
export class FrameCollector {
  frames: CalFrameLevels[] = []
  private readonly win: number
  private pendRaw: number[] = []
  private pendProc: number[] = []
  private raws: Float32Array[] = []
  private procs: Float32Array[] = []

  constructor(
    readonly sampleRate: number,
    private readonly keepSamples = false,
  ) {
    this.win = Math.round(CAL_FRAME_SEC * sampleRate)
  }

  /** Forgets everything collected. */
  reset(): void {
    this.frames = []
    this.pendRaw = []
    this.pendProc = []
    this.raws = []
    this.procs = []
  }

  /** Seconds of whole frames collected. */
  get seconds(): number {
    return this.frames.length * CAL_FRAME_SEC
  }

  /** Adds aligned raw and processed samples; returns the whole frames this push completed. */
  push(raw: Float32Array, proc: Float32Array): CalFrameLevels[] {
    const n = Math.min(raw.length, proc.length)
    const r = this.pendRaw.length ? Float32Array.from([...this.pendRaw, ...raw.subarray(0, n)]) : raw.subarray(0, n)
    const p = this.pendProc.length ? Float32Array.from([...this.pendProc, ...proc.subarray(0, n)]) : proc.subarray(0, n)
    const whole = Math.floor(r.length / this.win) * this.win
    const out: CalFrameLevels[] = []
    for (let s = 0; s < whole; s += this.win) {
      const [rawDb, rawPeakDb] = levelsOf(r, s, s + this.win)
      const [procDb, procPeakDb] = levelsOf(p, s, s + this.win)
      out.push({ rawDb, rawPeakDb, procDb, procPeakDb })
    }
    if (this.keepSamples && whole) {
      this.raws.push(r.slice(0, whole))
      this.procs.push(p.slice(0, whole))
    }
    this.pendRaw = Array.from(r.subarray(whole))
    this.pendProc = Array.from(p.subarray(whole))
    this.frames.push(...out)
    return out
  }

  /** The kept samples of the whole frames, raw and processed (empty without keepSamples). */
  samples(): { raw: Float32Array; proc: Float32Array } {
    const join = (parts: Float32Array[]): Float32Array => {
      const out = new Float32Array(parts.reduce((s, x) => s + x.length, 0))
      let at = 0
      for (const x of parts) {
        out.set(x, at)
        at += x.length
      }
      return out
    }
    return { raw: join(this.raws), proc: join(this.procs) }
  }
}

/** What a quiet stretch measured, dBFS. */
export interface QuietLevels {
  /** The room on the raw mic: median frame level, and P90 of the frames' sample peaks (what a gate's detector sees). */
  roomDb: number
  roomPeakDb: number
  /** The pauses as heard: the processed median frame level and P90 of its peaks. */
  pausesDb: number
  pausesPeakDb: number
  /**
   * Their loudest moments: the second loudest processed frame (one click is no burst), dBFS. Against Noise Removal's
   * digital silence the median reads silence while the room comes through for a moment now and then (burstsIn).
   */
  pausesLoudDb: number
  /** Share of processed frames that are digital silence. */
  silentShare: number
}

/** The second loudest of some levels, dBFS (the loudest when there is one, NaN when none). */
export function loudMoment(levels: readonly number[]): number {
  const s = [...levels].sort((a, b) => b - a)
  return s[Math.min(1, s.length - 1)] ?? NaN
}

export function quietLevels(frames: readonly CalFrameLevels[]): QuietLevels {
  return {
    pausesLoudDb: loudMoment(frames.map((f) => f.procDb)),
    roomDb: median(frames.map((f) => f.rawDb)),
    roomPeakDb: pct(frames.map((f) => f.rawPeakDb), 0.9),
    pausesDb: median(frames.map((f) => f.procDb)),
    pausesPeakDb: pct(frames.map((f) => f.procPeakDb), 0.9),
    silentShare: frames.length ? frames.filter((f) => f.procDb <= FLOOR_DB).length / frames.length : 0,
  }
}

/** A frame of speech: TALK_OVER_ROOM_DB over the room and over −70 dBFS (the tuner's speech frames, prepareTake). */
export const speechFrame = (f: Pick<CalFrameLevels, 'rawDb'>, roomDb: number): boolean => f.rawDb > roomDb + TALK_OVER_ROOM_DB && f.rawDb > -70

/**
 * Bursts in quiet pauses (the tuner's measure, ../tune/measure.ts burstsOf): their loudest moment is audible (over
 * PAUSE_SILENT_DB) and stands BURST_OVER_DB over their typical level — the room let through for a moment.
 */
export const burstsIn = (q: Pick<QuietLevels, 'pausesDb' | 'pausesLoudDb'>): boolean => q.pausesLoudDb > PAUSE_SILENT_DB && q.pausesLoudDb >= q.pausesDb + BURST_OVER_DB

/**
 * The pauses are as quiet as the person wants: digital silence or PAUSE_SILENT_DB and under, typically and at their
 * loudest moments (no bursts: judging by the median alone read Noise Removal letting the room through now and then as
 * silent).
 */
export const pausesSilent = (q: Pick<QuietLevels, 'pausesDb' | 'pausesLoudDb'>): boolean => q.pausesDb <= PAUSE_SILENT_DB && !burstsIn(q)

/** How loud the pauses are heard: their loudest moment when it is a burst, else their typical level, dBFS. */
export const heardPausesDb = (q: Pick<QuietLevels, 'pausesDb' | 'pausesLoudDb'>): number => (burstsIn(q) ? q.pausesLoudDb : q.pausesDb)

/**
 * Someone talked: TALK_FRAMES frames in a row TALK_OVER_ROOM_DB over the room. Without a known room, over the
 * quietest fifth of the frames themselves (a room is steady; a voice is not); raw digital silence is no room (the
 * aligned raw starts with the chain's latency of zeros).
 */
export function talked(frames: readonly CalFrameLevels[], roomDb?: number): boolean {
  const room = roomDb ?? pct(frames.filter((f) => f.rawDb > FLOOR_DB).map((f) => f.rawDb), 0.2)
  if (!Number.isFinite(room)) return false
  let run = 0
  for (const f of frames) {
    run = f.rawDb > room + TALK_OVER_ROOM_DB ? run + 1 : 0
    if (run >= TALK_FRAMES) return true
  }
  return false
}
