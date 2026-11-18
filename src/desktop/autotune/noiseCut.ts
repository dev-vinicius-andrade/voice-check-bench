// "Cut the noise" on the result step (SPEC "Cut the noise"): what to change so the noise measured in the recording
// goes away before the voice is treated. Framework-free.
// CONTRACT: the signatures and their meaning are fixed (the result step's hooks are written against them).
import type { Msg } from '../../plain/types'
import { eqKey } from '../advice/chain'
import type { ChainSlot, Change, EqField } from '../advice/types'
import { readReaFir, subtractState } from '../reafir/state'
import { eqPointsOf, NOTCH_BW_OCT, notchPlan } from '../spectrum/eqCurve'
import { steadyTonesOf } from '../spectrum/steady'
import type { ToneFound } from '../spectrum/tones'
import { noiseStretches, voiceNoiseOf } from '../spectrum/voiceNoise'
import type { TakeSummary, TuneResult } from '../tune'
import { gateLowsEdits } from '../tune/gateLows'
import { SILENT_DB, TUNE_SAMPLE_RATE } from '../tune/measure'
import type { WlChainEntry } from '../types'
import { allChanges, editManual, remeasured, type ManualEdit } from './manualEq'

/** How hard the measured noise is subtracted, dB over the measurement. */
export type NoiseCutAmount = 'light' | 'normal' | 'strong'
export const NOISE_CUT_DB: Readonly<Record<NoiseCutAmount, number>> = { light: -6, normal: 0, strong: 6 }

/** The chain's own noise remover, raised step by step by fitRemover: its slot, the value key and the value it has now. */
export interface NoiseRemover {
  slot: number
  key: 'strength'
  from: number
}

export interface NoiseCutPlan {
  /**
   * The ReaFIR slot and its new state (Subtract with the measured noise); null when the chain has no usable ReaFIR,
   * and always null when the chain has a switched-on Elgato Noise Removal (`remover` does the noise then).
   */
  reafir: { slot: number; state: string } | null
  /** The switched-on Elgato Noise Removal whose strength fitRemover raises; null without one (ReaFIR is used then). */
  remover: NoiseRemover | null
  /**
   * Values to set by hand on the chain as it is (ManualEdit-style: slot, key, to), in order: a narrow ReaEQ cut per
   * steady tone (tones closer than a sixth of an octave share one wider cut; free bands only, notchPlan's rules),
   * then the gates' detector high-pass (gateLowsEdits).
   */
  edits: { slot: number; key: string; to: number }[]
  /** What could not be done, for the person (no ReaFIR in the chain, no free ReaEQ band for a tone, …). */
  notes: Msg[]
}

/** Tones this close (octaves, from the lowest of them) share one cut. */
export const TONE_GROUP_OCT = 1 / 6
/** Widest cut shared by several tones, octaves. */
export const GROUP_CUT_MAX_OCT = 0.3

const NOTES = 'desktop.autotune.ui.noiseCut.notes'
type Edit = NoiseCutPlan['edits'][number]

/** The first switched-on ReaFIR's Subtract state from the take's noise, or the note why there is none. */
function reafirCut(take: Float32Array, chain: readonly ChainSlot[], entries: readonly WlChainEntry[], amount: NoiseCutAmount): { reafir: NoiseCutPlan['reafir']; note: Msg | null } {
  const fir = chain.find((s) => s.kind === 'reafir' && s.on)
  if (!fir) return { reafir: null, note: { key: `${NOTES}.noReaFir` } }
  const entry = entries.find((e) => e.index === fir.index)
  if (!entry || !readReaFir(entry.parameterState)) return { reafir: null, note: { key: `${NOTES}.reaFirUnknown` } }
  const noise = voiceNoiseOf(take, take, noiseStretches(take, TUNE_SAMPLE_RATE), TUNE_SAMPLE_RATE)
  if (!noise) return { reafir: null, note: { key: `${NOTES}.noNoise` } }
  const state = subtractState(entry.parameterState, { freqsHz: noise.freqsHz, noiseDb: noise.noiseDb }, NOISE_CUT_DB[amount])
  return state ? { reafir: { slot: fir.index, state }, note: null } : { reafir: null, note: { key: `${NOTES}.reaFirUnknown` } }
}

/** Tones within TONE_GROUP_OCT of the lowest of their group, as groups; the strongest group (overDb) first. */
function toneGroups(tones: readonly ToneFound[]): ToneFound[][] {
  const groups: ToneFound[][] = []
  for (const t of [...tones].filter((x) => x.freqHz > 0).sort((a, b) => a.freqHz - b.freqHz)) {
    const g = groups[groups.length - 1]
    if (g && Math.log2(t.freqHz / g[0].freqHz) <= TONE_GROUP_OCT) g.push(t)
    else groups.push([t])
  }
  const strongest = (g: readonly ToneFound[]): number => Math.max(...g.map((t) => t.overDb))
  return groups.sort((a, b) => strongest(b) - strongest(a))
}

/**
 * One narrow cut per tone group on `eq` (the first switched-on ReaEQ), each on its own free band: a group's cut sits
 * at the geometric mean of its outer tones, wide enough to cover them plus NOTCH_BW_OCT (at most GROUP_CUT_MAX_OCT),
 * as deep as notchPlan cuts its strongest tone. A tone left without a band gets a note.
 */
function toneCuts(take: Float32Array, eq: ChainSlot | undefined): { edits: Edit[]; notes: Msg[] } {
  const edits: Edit[] = []
  const notes: Msg[] = []
  let slot = eq
  for (const group of toneGroups(steadyTonesOf(take, TUNE_SAMPLE_RATE))) {
    const lo = group[0].freqHz
    const hi = group[group.length - 1].freqHz
    const strongest = group.reduce((a, b) => (b.overDb > a.overDb ? b : a))
    const centre = Math.sqrt(lo * hi)
    const plan = slot ? notchPlan(eqPointsOf(slot), { freqHz: centre, levelDb: strongest.levelDb, overDb: strongest.overDb, inRaw: true, inProcessed: false }) : null
    if (!slot || !plan) {
      for (const t of group) notes.push({ key: `${NOTES}.noBand`, params: { hz: Math.round(t.freqHz) } })
      continue
    }
    const bwOct = group.length > 1 ? Math.min(GROUP_CUT_MAX_OCT, Math.ceil((Math.log2(hi / lo) + NOTCH_BW_OCT) * 100) / 100) : plan.bwOct
    const steps: [EqField, number][] = [['freqHz', plan.freqHz], ['bwOct', bwOct], ['gainDb', plan.gainDb]]
    if (plan.enable) steps.push(['on', 1])
    const values = { ...slot.values }
    for (const [field, to] of steps) {
      const key = eqKey(plan.n, field)
      edits.push({ slot: slot.index, key, to })
      values[key] = to
    }
    // the band now holds this cut: the next group plans on the chain with it
    slot = { ...slot, values }
  }
  return { edits, notes }
}

/**
 * The plan for this take on this chain. `take` is the raw recording, `chain` the chain as it is now (the tuned chain
 * with the hand edits), `entries` the Wave Link entries of the same input (ReaFIR's current ParameterState is read
 * from them). Pure: nothing is applied here.
 */
export function planNoiseCut(take: Float32Array, chain: readonly ChainSlot[], entries: readonly WlChainEntry[], amount: NoiseCutAmount): NoiseCutPlan {
  const remover = removerOf(chain)
  // the chain's own remover does the noise: ReaFIR is left as it is (the tuner switches it off when it cuts the voice)
  const fir = remover ? { reafir: null, note: null } : reafirCut(take, chain, entries, amount)
  const tones = toneCuts(take, chain.find((s) => s.kind === 'reaeq' && s.on))
  return {
    reafir: fir.reafir,
    remover,
    edits: [...tones.edits, ...gateLowsEdits(chain)],
    notes: [...(fir.note ? [fir.note] : []), ...tones.notes],
  }
}

/** The first switched-on Elgato Noise Removal with a strength, as the plan's remover; null without one. */
function removerOf(chain: readonly ChainSlot[]): NoiseRemover | null {
  const nr = chain.find((s) => s.kind === 'noiseRemoval' && s.on && Number.isFinite(s.values.strength))
  return nr ? { slot: nr.index, key: 'strength', from: nr.values.strength } : null
}

/**
 * How far under the voice every noise region must end, dB, by amount. Normal is what Noise Removal 80 reached on the
 * real chain (SPEC "Cut the noise": the lows 52.9 dB and the whistle region 58.9 dB under the voice, voice untouched).
 */
export const REMOVER_TARGET_DB: Readonly<Record<NoiseCutAmount, number>> = { light: 40, normal: 50, strong: 60 }
/** The strengths tried, ascending (only those above the current one). 100 is never tried: it took the whole voice. */
export const REMOVER_LADDER: readonly number[] = [60, 70, 80, 90, 95]
/** Renders of the ladder at most (the render at the current strength comes first and is not counted). */
export const REMOVER_MAX_RENDERS = 5
/** The voice is intact when its word loss is at most this much worse than at the current strength, dB, */
export const VOICE_WORD_LOSS_DB = 1
/** its speech level at most this much lower, dB, */
export const VOICE_SPEECH_DB = 1
/** and no tone band moved by more than this, dB (and it is not silent). */
export const VOICE_TONE_DB = 1.5
/** A strength short of the target is kept only when it lowered the worst region by at least this much, dB. */
export const REMOVER_MIN_GAIN_DB = 3

/** One render: the strength and what it measured. */
export interface RemoverStep {
  strength: number
  /** Each region's noise under the voice, dB (low, mid, high); empty when the render could not be measured. */
  underDb: number[]
  speechDb: number
  wordLossDb: number
  /** The voice as it was at the current strength (always true for the current strength's own render). */
  intact: boolean
}

export interface FitRemoverInput {
  /** The raw take. */
  take: Float32Array
  /** The tune result the edits are on (its `changes` render first). */
  result: TuneResult
  /** The session's chain with the result's changes (tunedChain): what the edits are made on. */
  tuned: readonly ChainSlot[]
  /** The hand edits with the plan's own edits (the whistle cuts) already on. */
  edits: readonly ManualEdit[]
  /** The session's render (serialised there, so it never races the hand-edit render queue). */
  render: (changes: readonly Change[]) => Promise<Float32Array>
  remover: NoiseRemover
  amount: NoiseCutAmount
  /** Called before each render of the ladder with the strength tried. */
  onStep?: (strength: number) => void
}

export interface FitRemoverResult {
  /** The strength to set (a hand edit), or null to leave it as it is. */
  edit: { slot: number; key: string; to: number } | null
  /** Why it stopped short of the target, or why nothing changed (none when the noise is already at the target). */
  note: Msg | null
  /** Renders made, the one at the current strength included. */
  renders: number
  /** What each render measured: the current strength first, then the ladder in the order tried. */
  steps: RemoverStep[]
}

const worstOf = (s: RemoverStep): number => (s.underDb.length ? Math.min(...s.underDb) : NaN)
const finite = Number.isFinite

/** `now` keeps the voice of `base` (word loss, speech level, tone) and is not silent. */
function voiceIntact(base: TakeSummary, now: TakeSummary): boolean {
  if (!(now.speechDb > SILENT_DB)) return false
  if (finite(base.speechDb) && !(now.speechDb >= base.speechDb - VOICE_SPEECH_DB)) return false
  if (finite(base.wordLossDb) && !(now.wordLossDb <= base.wordLossDb + VOICE_WORD_LOSS_DB)) return false
  return base.tone.every((b, i) => !finite(b) || Math.abs(now.tone[i] - b) <= VOICE_TONE_DB)
}

/**
 * The Noise Removal strength for this take (SPEC "Cut the noise"): renders the take with the edits at the current
 * strength, then up the ladder above it, and takes the first strength where every noise region sits at least the
 * amount's target under the voice while the voice stays as it was at the current strength. A strength that harms the
 * voice ends the search. Short of the target: the strongest one that kept the voice and lowered the worst region by
 * REMOVER_MIN_GAIN_DB, with a note; nothing that helps: null with a note. Already at the target: null, no note.
 */
export async function fitRemover(input: FitRemoverInput): Promise<FitRemoverResult> {
  const { take, result, tuned, edits, render, remover, amount, onStep } = input
  const stretches = noiseStretches(take, TUNE_SAMPLE_RATE)
  const target = REMOVER_TARGET_DB[amount]
  const steps: RemoverStep[] = []
  const measureAt = async (strength: number, at: readonly ManualEdit[]): Promise<{ step: RemoverStep; after: TakeSummary }> => {
    const processed = await render(allChanges(result.changes, at))
    const after = remeasured(take, result, processed).after
    const noise = voiceNoiseOf(processed, take, stretches, TUNE_SAMPLE_RATE)
    const underDb = noise ? noise.regions.map((r) => r.underVoiceDb) : []
    const step: RemoverStep = { strength, underDb, speechDb: after.speechDb, wordLossDb: after.wordLossDb, intact: true }
    steps.push(step)
    return { step, after }
  }
  const done = (edit: FitRemoverResult['edit'], note: Msg | null): FitRemoverResult => ({ edit, note, renders: steps.length, steps })
  const noHelp = (): FitRemoverResult => done(null, { key: `${NOTES}.removerNoHelp` })

  const base = await measureAt(remover.from, edits)
  const baseWorst = worstOf(base.step)
  if (!finite(baseWorst) || !(base.after.speechDb > SILENT_DB)) return noHelp()
  if (baseWorst >= target) return done(null, null)

  let best: number | null = null
  for (const strength of REMOVER_LADDER.filter((s) => s > remover.from).slice(0, REMOVER_MAX_RENDERS)) {
    onStep?.(strength)
    const { step, after } = await measureAt(strength, editManual(tuned, edits, remover.slot, remover.key, strength))
    const worst = worstOf(step)
    step.intact = finite(worst) && voiceIntact(base.after, after)
    // the voice suffers from here on: nothing stronger is tried
    if (!step.intact) break
    if (worst >= target) return done({ slot: remover.slot, key: remover.key, to: strength }, null)
    if (worst - baseWorst >= REMOVER_MIN_GAIN_DB) best = strength
  }
  return best === null ? noHelp() : done({ slot: remover.slot, key: remover.key, to: best }, { key: `${NOTES}.removerLimit` })
}
