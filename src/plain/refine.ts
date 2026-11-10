// Closed-loop refinement of applied settings (SPEC "Refinement loop (v1.1)"). Pure.
// A processed take recorded with `applied` is judged against the raw reference of its session (the suggestion base);
// when it did not improve, refine() returns the next settings to try, with one plain message per change.
import { PEAK_WARN_DB, TARGET_SPEECH_DB } from '../audio/diagnose'
import { deviations, STYLE_OFFSETS } from '../audio/reference'
import { distanceMismatch, refDistance, type DistanceMismatch } from '../session/distance'
import { takeDist } from '../session/steps'
import { BY_EAR_DB, type SuggestionJson } from '../settings/suggest'
import { englishText } from '../settings/english'
import {
  DEFAULT_GOAL,
  isAnalysisError,
  type AppliedSettings,
  type EqBand,
  type RefineReason,
  type Refinement,
  type Take,
  type VoiceGoal,
} from '../types'
import { compareProcessed, type Regression } from './compare'
import { clarityScore } from './score'
import type { Msg } from './types'

/** Improved = the processed take scores at least this many points over the raw one, with no regressions (as profiles). */
export const IMPROVE_POINTS = 5
/** Share of exact-zero samples above which the processing is chopping the voice, even without a regression vs raw. */
export const CHOPPED_ZERO = 0.05
/** A level drop from this many dB is made up with the compressor Wet. */
export const QUIETER_REFINE_DB = 4
/** ReaComp Wet never goes above this, dB. */
export const WET_CAP = 18
/** Too loud and the peak clipped: Wet goes down at least this many dB. */
export const CLIP_MIN_DROP_DB = 3
/** Gate threshold step when it cuts the voice, and the lowest threshold, dB. */
export const GATE_STEP_DB = 10
export const GATE_MIN_DB = -72
/**
 * ReaGate adds Wet (the gated voice) and Dry (the untouched voice). With both near 0 dB the voice passes twice and is
 * about 6 dB louder whenever the gate opens. Dry above this, with Wet open, is "doubled".
 */
export const GATE_DOUBLE_DRY_DB = -10
/** Dry a doubled gate goes back to: pauses 20 dB down, the open voice only 0.8 dB louder (the soft gate of the suggestion). */
export const GATE_SOFT_DRY_DB = -20
/** Wet all the way down: only Dry (0 dB) passes, untouched. This is ReaGate switched off. */
export const GATE_OFF_WET_DB = -100
/** Harsh: the 3.5 kHz band and the high shelf go down by this share of the presence/sibilance rise, never below −4 dB. */
export const HARSH_K = 0.7
export const HARSH_MIN_DB = -4
/** Still noisy: the processed take gained less than this much SNR over raw. */
export const STILL_NOISY_DB = 3
/** After this many attempts without improving: change approach instead of tweaking numbers. */
export const MAX_ATTEMPTS = 3

type JudgedTake = Pick<Take, 'step' | 'name' | 'analysis'>
type Route = AppliedSettings['noiseRemoval']

export interface ProcessedEvaluation {
  /** fxScore ≥ rawScore + 5, no regressions and recorded at the right distance. */
  improved: boolean
  rawScore: number
  fxScore: number
  regressions: Regression[]
  /** Set when the processed take was recorded at another distance: it does not judge the settings. */
  mismatch: DistanceMismatch | null
  /** Speech level lost to the effects, dB (negative when louder). */
  levelDrop: number
}

/**
 * Distance the settings are judged at: the one the applied settings were made for (a processed take recorded elsewhere
 * says nothing about them, even when it is compared with the raw control at its own distance), else the raw
 * reference's distance when the applied settings carry none.
 */
export const baseDistance = (raw: Pick<Take, 'step' | 'name'>, applied: Pick<AppliedSettings, 'dist'>): string =>
  refDistance(applied) ?? takeDist(raw) ?? applied.dist

/** Scores, regressions and the distance check of a processed take; null when either take has no analysis. */
export function evaluateProcessed(raw: JudgedTake, fx: JudgedTake, applied: AppliedSettings, goal: VoiceGoal = DEFAULT_GOAL): ProcessedEvaluation | null {
  const r = raw.analysis
  const f = fx.analysis
  if (isAnalysisError(r) || isAnalysisError(f)) return null
  const rawScore = clarityScore(r, { goal }).score
  const fxScore = clarityScore(f, { raw: r, goal }).score
  const { regressions, levelDrop } = compareProcessed(r, f)
  const mismatch = distanceMismatch(fx, baseDistance(raw, applied))
  const improved = !mismatch && fxScore >= rawScore + IMPROVE_POINTS && regressions.length === 0
  return { improved, rawScore, fxScore, regressions, mismatch, levelDrop }
}

const r05 = (v: number): number => Math.round(v * 2) / 2 || 0
const pm = (key: string, params?: Msg['params']): Msg => (params ? { key: `plain.refine.${key}`, params } : { key: `plain.refine.${key}` })
/** EQ reasons of refined bands (suggest.json; exports stay English). */
export const REFINED_WHY = ['boom', 'warmth', 'presence', 'top'] as const
const refinedWhy = (key: (typeof REFINED_WHY)[number]): string => englishText({ key: `suggestx.why.refined.${key}` })
const aiRoute = (route: Route): Route => (route === 'ai-nvidia' ? 'ai-nvidia' : 'ai-elgato')

const cloneSettings = (s: SuggestionJson): SuggestionJson => JSON.parse(JSON.stringify(s)) as SuggestionJson

type Gate = SuggestionJson['gate']
const amp = (db: number): number => 10 ** (db / 20)
/** Level of the voice while the gate is open, relative to the input, dB (Wet and Dry add up). */
const openGainDb = (g: Pick<Gate, 'wet' | 'dry'>): number => 20 * Math.log10(amp(g.wet) + amp(g.dry))
/** Wet all the way down: the gate is off (only the untouched Dry passes). */
export const gateIsOff = (g: Pick<Gate, 'wet'>): boolean => g.wet <= GATE_OFF_WET_DB + 40
/** The gate never cuts anything: off, or Dry at 0 dB or above (the voice always passes untouched). */
const gatePassesAll = (g: Pick<Gate, 'wet' | 'dry'>): boolean => gateIsOff(g) || g.dry >= -1
/** Wet open and Dry high: the voice passes twice. */
export const gateDoubles = (g: Pick<Gate, 'wet' | 'dry'>): boolean => !gateIsOff(g) && g.dry > GATE_DOUBLE_DRY_DB

/** Highest gain the bass bands may reach when undoing a cut: 0, or the goal's extra bass (warm, or "thin" heard). */
function bassCap(goal: VoiceGoal, band: 1 | 2): number {
  const style = Object.hasOwn(STYLE_OFFSETS, goal.style) ? STYLE_OFFSETS[goal.style][band] : 0
  return Math.max(0, style, goal.perceived.includes('thin') ? BY_EAR_DB : 0)
}

/** Inserts a band before the high shelf / notches that follow it in frequency, keeping the suggestion's order. */
function insertBand(eq: EqBand[], band: EqBand): void {
  const i = eq.findIndex((e) => e.freq > band.freq)
  eq.splice(i < 0 ? eq.length : i, 0, band)
}

/** What the person can do once tweaking numbers stopped helping (shown when `changeApproach` is set). */
export function changeApproachAdvice(): Msg[] {
  return ['ai', 'placement', 'closer'].map((k) => pm(`changeApproach.${k}`))
}

/**
 * Next settings after a processed take that did not improve (SPEC rules, in this order): wrong distance (re-record
 * first, nothing else changes) · change approach after 3 attempts · chopped · too loud or quieter · thin · harsh
 * (or "harsh from clipping" when too loud) · still noisy.
 * `settings` is always a deep copy of `applied.settings`. Null when either take has no analysis.
 */
export function refine(raw: JudgedTake, fx: JudgedTake, applied: AppliedSettings, goal: VoiceGoal = DEFAULT_GOAL): Refinement | null {
  const ev = evaluateProcessed(raw, fx, applied, goal)
  const r = raw.analysis
  const f = fx.analysis
  if (!ev || isAnalysisError(r) || isAnalysisError(f)) return null
  const settings = cloneSettings(applied.settings)
  const dist = baseDistance(raw, applied)
  const changes: Refinement['changes'] = []
  const push = (reason: RefineReason, msg: Msg): void => void changes.push({ reason, msg })
  let route: Route = applied.noiseRemoval
  const done = (changeApproach = false): Refinement => ({ settings, changes, noiseRemoval: route, dist, changeApproach })

  if (ev.mismatch) {
    push('wrongDistance', ev.mismatch.msg)
    return done()
  }
  if (ev.improved) return done()
  const attempt = applied.attempt
  if (attempt >= MAX_ATTEMPTS) {
    route = aiRoute(route)
    return done(true)
  }

  // chopped: noise removal and the gate are cutting the voice
  const chopped = ev.regressions.includes('chopped') || f.zeroRatio > CHOPPED_ZERO
  const g = settings.gate
  const appliedGate = applied.settings.gate
  if (chopped) {
    if (route === 'reafir') {
      if (attempt >= 2) {
        route = 'ai-elgato'
        push('chopped', pm('chopped.toAi'))
      } else push('chopped', pm('chopped.reafirHalf'))
    } else if (route === 'ai-elgato' || route === 'ai-nvidia') push('chopped', pm('chopped.aiLower'))
    // off, or Dry at 0 dB: the voice always passes untouched, so the gate is not what cuts it
    if (gatePassesAll(appliedGate)) {
      if (route === 'none') push('chopped', pm('chopped.other'))
    } else {
      const lowered = Math.max(GATE_MIN_DB, g.threshold - GATE_STEP_DB)
      if (attempt < 2 && lowered < g.threshold) {
        push('gateTooHigh', pm('gateTooHigh', { db: g.threshold - lowered, to: lowered }))
        g.threshold = lowered
      } else {
        // off = Wet all the way down and Dry 0 dB (never Wet and Dry both at 0 dB: that doubles the voice)
        g.wet = GATE_OFF_WET_DB
        g.dry = 0
        push('chopped', pm('chopped.gateOff'))
      }
    }
  }

  // doubled: Wet and Dry both open add the voice twice (+6 dB at 0/0) whenever the gate opens
  let gateCutDb = 0
  if (gateDoubles(appliedGate)) {
    gateCutDb = openGainDb(appliedGate) - openGainDb({ wet: appliedGate.wet, dry: GATE_SOFT_DRY_DB })
    push('gateDoubled', pm('gateDoubled', { from: appliedGate.dry, to: GATE_SOFT_DRY_DB }))
    g.dry = GATE_SOFT_DRY_DB
  }

  const tooLoud = ev.regressions.includes('tooLoud')
  const c = settings.comp
  if (tooLoud) {
    // too loud: the compressor's Wet comes down so speech lands in the middle of the good range (3+ dB when it clipped);
    // whatever the doubled gate's fix already takes off counts
    const clipped = f.peak >= PEAK_WARN_DB
    const speech = f.speechMed - gateCutDb
    const drop = Math.max(Math.ceil(speech - TARGET_SPEECH_DB), clipped ? Math.ceil(CLIP_MIN_DROP_DB - gateCutDb) : 0, 0)
    const to = Math.max(0, c.wet - drop)
    if (to < c.wet) {
      push('tooLoud', pm('tooLoud', { db: c.wet - to, to }))
      c.wet = to
    } else if (drop > 0) push('tooLoud', pm('tooLoudGain'))
  } else if (ev.levelDrop >= QUIETER_REFINE_DB) {
    // quieter: the compressor makes up the level that was lost, never past the middle of the good range
    const raise = Math.min(Math.round(ev.levelDrop), Math.floor(TARGET_SPEECH_DB - f.speechMed))
    const to = Math.min(WET_CAP, c.wet + raise)
    if (raise > 0 && to > c.wet) {
      push('quieter', pm('quieter', { drop: Math.round(ev.levelDrop), db: to - c.wet, to }))
      c.wet = to
    }
  }

  const dr = deviations(r.rel)
  const df = deviations(f.rel)
  const findBand = (type: EqBand['type'], freq: number): EqBand | undefined => settings.eq.find((e) => e.type === type && e.freq === freq)

  // thin: undo the bass cuts by the boom / warmth the processing lost (toward 0, past it only when the goal wants bass)
  if (ev.regressions.includes('thin')) {
    const slots = [
      { type: 'Low Shelf', freq: 150, band: 1, key: 'boom' },
      { type: 'Band', freq: 250, band: 2, key: 'warmth' },
    ] as const
    for (const s of slots) {
      const e = findBand(s.type, s.freq)
      const loss = dr[s.band] - df[s.band]
      if (!e || !(loss > 0)) continue
      const to = Math.min(bassCap(goal, s.band), r05(e.gain + loss))
      if (to <= e.gain) continue
      push('thin', pm(`thin.${s.key}`, { from: e.gain, to }))
      e.gain = to
      e.why = refinedWhy(s.key)
      delete e.byEar
    }
  }

  // harsh from clipping: the limiter's distortion, not the EQ; the level comes down first
  if (ev.regressions.includes('harsh') && tooLoud) push('harsh', pm('harshFromClipping'))
  // harsh: presence band and high shelf down by 0.7 x the rise, never below -4 dB
  else if (ev.regressions.includes('harsh')) {
    const rise = Math.max(...[6, 7].map((i) => df[i] - dr[i]).filter(Number.isFinite))
    const slots = [
      { type: 'Band', freq: 3500, bw: 1.4, key: 'presence' },
      { type: 'High Shelf', freq: 10000, bw: 2.0, key: 'top' },
    ] as const
    for (const s of slots) {
      const e = findBand(s.type, s.freq)
      const from = e?.gain ?? 0
      const to = Math.max(HARSH_MIN_DB, r05(from - rise * HARSH_K))
      if (!(to < from)) continue
      push('harsh', pm(`harsh.${s.key}`, { from, to }))
      if (e) {
        e.gain = to
        e.why = refinedWhy(s.key)
        delete e.byEar
      } else insertBand(settings.eq, { type: s.type, freq: s.freq, gain: to, bw: s.bw, why: refinedWhy(s.key) })
    }
  }

  // still noisy: no regression, but the effects barely beat the room
  if (!chopped && ev.regressions.length === 0 && f.snr < r.snr + STILL_NOISY_DB) {
    if (route === 'reafir') {
      if (attempt >= 2) {
        route = 'ai-elgato'
        push('stillNoisy', pm('stillNoisy.toAi'))
      } else push('stillNoisy', pm('stillNoisy.reafirMore'))
    } else if (route === 'none') {
      route = 'ai-elgato'
      push('stillNoisy', pm('stillNoisy.addAi'))
    } else push('stillNoisy', pm('stillNoisy.aiStronger'))
  }

  return done()
}
