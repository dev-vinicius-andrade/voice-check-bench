// "Tune from a recording" contract (SPEC "Desktop app (v2.0)" → Tune from a recording). Framework-free: no React, no
// Tauri. The tuner gets one raw take, what the person wants and the live chain, renders the take through the real
// chain with candidate values (an injected, expensive `render`), measures the whole take and keeps only the changes
// that measurably help.
import type { Msg } from '../../plain/types'
import type { VoiceStyle } from '../../types'
import type { ProcessingAmount } from '../advice/prefs'
import type { ChainSlot, Change, ValueChange } from '../advice/types'

/** What the voice is for. It moves the noise and consistency targets (./targets.ts). */
export type TuneUse = 'streaming' | 'calls' | 'recording'

/** What bothers the person about their sound. Each one moves a target or allows a stronger tool (./targets.ts). */
export type Bother =
  | 'roomNoise'
  | 'boomy'
  | 'muffled'
  | 'thin'
  | 'harsh'
  | 'sharpS'
  | 'dull'
  | 'lacksClarity'
  | 'lacksPresence'
  | 'lacksBody'
  | 'nasal'
  | 'boxy'
  | 'tooQuiet'
  | 'tooLoud'
  | 'crackling'
  | 'unevenVolume'
  | 'wordsCut'
  | 'metallic'
  | 'noisePumps'
  | 'flat'
  | 'plosives'
  | 'hum'
  | 'hiss'

export interface TuneGoals {
  use: TuneUse
  /** The tone target: the reference curve plus the style's offsets (src/audio/reference.ts). */
  style: VoiceStyle
  bothers: Bother[]
  /** How far any single value may move from where the chain started, and how much EQ in total. */
  amount: ProcessingAmount
}

/** Stages in the order they run. `baseline` is the first render (the chain as it is). */
export type TuneStage = 'baseline' | 'level' | 'noise' | 'tone' | 'compression' | 'trim'

/**
 * Renders the WHOLE take through the chain with these changes (values, and slots switched on or off) applied on top
 * of the chain as it started (an empty list = the chain as it is). The output has the take's length and is aligned to
 * it, sample for sample. Expensive (seconds): the tuner counts every call against its budget.
 */
export type TuneRender = (changes: readonly Change[]) => Promise<Float32Array>

/** Score of a rendered take in penalty points: 0 = nothing left to fix, lower is better (./score.ts). */
export interface TuneScore {
  /** Speech level away from the target, peaks too close to clipping, clipped samples. */
  level: number
  /** Voice over pause noise below the wanted SNR. */
  noise: number
  /** Bands further from the goal's tone target than their tolerance. */
  tone: number
  /** Level spread above the wanted spread. */
  consistency: number
  /** Processing damage: dead digital silence, words cut off. */
  damage: number
  total: number
}

/** What a rendered take measures, over the whole take, on the speech and pause frames of the RAW take. */
export interface TakeSummary {
  /** Median level of the speech frames, dBFS. */
  speechDb: number
  /** Highest sample, dBFS. */
  peakDb: number
  /** Samples at full scale. */
  clipped: number
  /** Median level of the pause frames (room noise between and before the words), dBFS, never below −100. */
  pauseDb: number
  /** speechDb − pauseDb. */
  snrDb: number
  /**
   * Per BANDS entry (rumble … air): dB away from the goal style's target, level-matched on the middle bands so a deep
   * low-cut or one loud band cannot shift the others (./measure.ts robustTone). Positive = too much. Without the room:
   * the render's pause spectrum is taken off, and a band where the raw take has no measurable voice over the room is NaN.
   */
  tone: number[]
  /** Consistency: spread of the loudest level of each second of speech (P90 − P10), dB. */
  spreadDb: number
  /** Share of samples inside runs of exact zeros (digital silence from a gate or noise remover), 0..1. */
  deadSilence: number
  /** Runs of exact zeros that start, per 10 s. */
  gateSwitches: number
  /** How much less gain the quietest speech frames get than the loud ones, dB (above 2: words are being cut off). */
  wordLossDb: number
  /**
   * Speech cut by a gate at word starts and ends, measured against the same chain with its gates passing everything
   * (./measure.ts cutOf): share of the voice frames (10 ms) that sit more than 3 dB under the ungated render, 0..1,
   * and such cuts per 10 s. 0 without a working gate; NaN when it was not measured (no render left for it).
   */
  cutSpeech: number
  cutEvents: number
  /** How far a gate moves an audible room between pauses and words, dB (0 without a working gate or with a quiet room; NaN when not measured). */
  pumpDb: number
  /**
   * Bursts in the pauses: the room let through for a moment (by Noise Removal right after a word, or on and off in a
   * long pause), measured where the raw take is the room alone (./measure.ts burstsOf). `burstDb`: how far under the
   * voice the loudest one sits, dB (NaN: none, or not measurable); `burstEvents`: how many per 10 s of pauses (NaN: not
   * measurable). The noise score hears the pauses at their loudest burst (./score.ts heardSnrDb).
   */
  burstDb: number
  burstEvents: number
  /**
   * What Noise Removal and the gates cut of the words together, against the same chain without Noise Removal and with
   * its gates passing everything (the gates' own cutSpeech cannot see Noise Removal): share 0..1 and events per 10 s,
   * measured on the final state; NaN without Noise Removal on (or before the tuner).
   */
  removerCut: number
  removerCutEvents: number
  score: TuneScore
}

export type TuneMetric = 'speechDb' | 'peakDb' | 'snrDb' | 'tone' | 'spreadDb' | 'deadSilence' | 'wordLossDb' | 'cutSpeech' | 'burstDb' | 'removerCut'

/** The metric a change was made for: its value right before the change and in the final render. */
export interface TuneEffect {
  metric: TuneMetric
  /** BANDS index, for `tone`. */
  band?: number
  before: number
  after: number
}

/**
 * One kept change, as the person reads it. `titleMsg` is the reason in plain words (desktop.autotune.reason.*),
 * `changeMsg` the exact change line ("ReaComp Wet 6 → 14.5 dB", "ReaFIR off"). `reason` is the nearest "Try this"
 * reason, kept so the change is a Change the engine adapter already applies (compression changes use 'tooLoud');
 * `stage` says what the tuner did it for. It is a value change or a slot switched on / off (no from / to numbers).
 * A ReaEQ band whose frequency or width moved is ONE change: the band's line ("ReaEQ Band 2: 250 Hz, 2 oct, 0 dB →
 * 220 Hz, 1 oct, −5 dB"), with the band's other moved values in `also`. The engine takes them all: engineChanges().
 */
export type TuneChange = Change & {
  stage: TuneStage
  changeMsg: Msg
  effect: TuneEffect
  /** The other values of the same ReaEQ band that moved with this one (frequency, width, gain). */
  also?: ValueChange[]
}

/** A value change of a result with what the result says about it. */
export type TuneValueChange = ValueChange & Pick<TuneChange, 'stage' | 'changeMsg' | 'effect'>

/** The value changes of a result, flat (a band's `also` values carry their change's stage, line and effect); no switches. */
export const valueChanges = (changes: readonly TuneChange[]): TuneValueChange[] =>
  changes.flatMap((c) => {
    if (c.kind !== 'value') return []
    const { also, ...own } = c
    return [own, ...(also ?? []).map((a) => ({ ...a, stage: c.stage, changeMsg: c.changeMsg, effect: c.effect }))]
  })

/** Every engine change of a result, flat: each change, then the values that moved with it (`also`). */
export const engineChanges = (changes: readonly (Change & { also?: readonly ValueChange[] })[]): Change[] =>
  changes.flatMap((c) => {
    const { also, ...own } = c
    return [own as Change, ...(also ?? [])]
  })

export type TuneLogEvent = 'info' | 'render' | 'keep' | 'revert' | 'skip'

/** Debug trail, English only (never shown as is). */
export interface TuneLogEntry {
  stage: TuneStage
  event: TuneLogEvent
  text: string
  /** Judged score of the render this entry is about. */
  score?: TuneScore
}

export interface TuneInput {
  /** Mono raw mic take: QUIET_SEC of room noise, then speech. */
  take: Float32Array
  /** Sample rate of the take and of every render (default 48000). */
  sampleRate?: number
  goals: TuneGoals
  /**
   * The live chain in real units, as it is before tuning. Only switched-on slots with the needed keys are tuned; a
   * ReaFIR may be switched off and a switched-off Noise Removal on, as candidates like any other (./switches.ts).
   */
  chain: readonly ChainSlot[]
  render: TuneRender
  /** Before each render: the stage, the render's number (from 1) and the budget. */
  onProgress?: (stage: TuneStage, pass: number, of: number) => void
  /** Render budget (default DEFAULT_MAX_RENDERS). */
  maxRenders?: number
  /** 0..1: scales the amount's caps (retune 'tooProcessed' on the lightest amount). Default 1. */
  limit?: number
  /** Changes of a previous result to start from (retune). They are kept only if they still beat the untouched chain. */
  start?: readonly TuneChange[]
  /** The render of `start`, when the caller still has it (the previous result's `processed`): saves one render. */
  startRender?: Float32Array
}

export interface TuneResult {
  /** Kept changes in chain order; empty = the chain is already good (or nothing could help). */
  changes: TuneChange[]
  /** The chain as it started. */
  before: TakeSummary
  /** The chain with `changes`. */
  after: TakeSummary
  /** The render of the chain with `changes`. */
  processed: Float32Array
  /** Renders used. */
  renders: number
  /** Goals the tuner could not reach, and why. */
  unmet: Msg[]
  log: TuneLogEntry[]
  /** What this run aimed for (retune starts from them). */
  goals: TuneGoals
  limit: number
}

/** What retune() hands to the next tune() call. */
export type TuneResume = Pick<TuneInput, 'goals' | 'limit' | 'start' | 'startRender'>
