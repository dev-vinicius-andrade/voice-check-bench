// Suggested ReaPlugs settings ported 1:1 from the prototype (docs/prototype/voice-check.html). Pure.
// Built from a RAW take (the mic before any effects), at the distance you'll actually use.
// Noisy room (SNR < 25 dB, SPEC "Noisy-room mode"): ReaFIR noise reduction first, EQ without boosts in
// noisy bands plus tone notches, a gentler compressor and the gate as a soft expander at the end.
import { targetDeviations } from '../audio/reference'
import { bestControl } from '../session/bestControl'
import { STEPS } from '../session/steps'
import { DEFAULT_MIC, addressTip, placementTip } from '../mics/catalog'
import { fusePerceived, type FusedIssue } from '../plain/perceived'
import type { Msg } from '../plain/types'
import { englishText, type MsgTranslator } from './english'
import {
  DEFAULT_GOAL,
  isAnalysisError,
  type Analysis,
  type EqBand,
  type MicProfile,
  type NoiseReductionGuide,
  type NoiseReductionPlan,
  type NoiseTone,
  type SuggestedEqBand,
  type Suggestion,
  type Take,
  type VoiceGoal,
} from '../types'

const msg = (key: string, params?: Msg['params']): Msg => (params ? { key, params } : { key })
/** Message under engine.suggest. */
const sm = (key: string, params?: Msg['params']): Msg => msg(`engine.suggest.${key}`, params)
/** Message under suggestx (suggest.json). */
const sx = (key: string, params?: Msg['params']): Msg => msg(`suggestx.${key}`, params)

/** Exported settings JSON consumed by tools/apply-reaplugs.py (SPEC "Exported settings JSON"). Text fields are English. */
export interface SuggestionJson {
  basedOn: string
  speechDbfs: number
  noiseDbfs: number
  gainHint: string
  noiseHint: string
  dist: string
  lowcut: Suggestion['lowcut']
  gate: Suggestion['gate']
  eq: EqBand[]
  comp: Suggestion['comp']
  deess: boolean
  noisyRoom: boolean
  noiseReduction: NoiseReductionPlan | null
  chain: string[]
}

const isRawControl = (t: Take | null): t is Take =>
  !!t && !isAnalysisError(t.analysis) && (t.step === 'c2' || t.step === 'c8' || t.step === 'c15')

/**
 * Base take for suggestions: the raw control take at the processed distance if present,
 * else the best control take, else null. `slots` = sessionSlots() of the session.
 */
export function pickSuggestionBase(slots: readonly (Take | null)[], fxDist: string | null, goal: VoiceGoal = DEFAULT_GOAL): Take | null {
  const best = bestControl(slots, goal)
  const dist = fxDist || best?.dist
  const atDist = slots.slice(0, 3).find((t, i) => isRawControl(t) && STEPS[i].dist === dist)
  return atDist ?? best?.take ?? null
}

const r05 = (v: number): number => Math.round(v * 2) / 2
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const sg = (v: number): string => (v > 0 ? '+' : '') + String(v)
/** Per-band value, NaN when unknown (the take had no usable silence window, so the arrays are empty). */
const at = (xs: readonly number[] | undefined, i: number): number => xs?.[i] ?? NaN

/** Below this SNR (dB) the room is noisy. */
const NOISY_SNR = 25
/** In a noisy room, a band whose voice-over-room SNR is below this gets no boost. */
const NO_BOOST_SNR = 12
const NOTCH_BW = 0.1
const MAX_NOTCHES = 3
const QUIET_CHAIN = ['ReaGate', 'ReaEQ', 'ReaComp']
const NOISY_CHAIN = ['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate']

/** A narrow, deep Band cut for a fan/server tone (see EqBand). */
export const isNotch = (e: Pick<EqBand, 'type' | 'bw'>): boolean => e.type === 'Band' && e.bw < 0.3

/** Below this SNR (dB) the voice is too close to the room for ReaFIR alone: AI noise removal is tried first. */
const PREFER_AI_SNR = 15

/**
 * Manual ReaFIR setup (profiles can't be written to Wave Link). The reduction starts gently (about 6 dB, then listen),
 * never a fixed room drop: too much reduction cuts the voice. `preferAi`: AI noise removal first, ReaFIR as the fallback.
 */
function reafirPlan(snr: number): NoiseReductionGuide {
  return {
    plugin: 'ReaFIR',
    steps: ['add', 'mode', 'profile', 'reduce', 'order', 'wet'].map((k) => msg(`suggestx.reafir.${k}`)),
    alternatives: ['elgato', 'voiceFocus', 'nvidia'].map((k) => sm(`alternative.${k}`)),
    preferAi: snr < PREFER_AI_SNR,
  }
}

/** Notches for the strongest steady tones (>= 12 dB), at most 3: -6 dB at 12 dB, down to -12 dB at 24 dB and above. */
function notches(tones: readonly NoiseTone[] | undefined): SuggestedEqBand[] {
  return (tones ?? [])
    .filter((t) => t.db >= 12)
    .sort((x, y) => y.db - x.db)
    .slice(0, MAX_NOTCHES)
    .map((t): SuggestedEqBand => ({ type: 'Band', freq: Math.round(t.hz), gain: -r05(6 + Math.min(6, (t.db - 12) / 2)), bw: NOTCH_BW, why: sm('why.tone', { db: t.db }) }))
}

/** Gentle correction for a perceived issue the measurement doesn't confirm, dB (never more). */
export const BY_EAR_DB = 1.5
/** Nasal band (confirmed): -2 to -4 dB, bandwidth 1 octave, centre between body and definition. */
const NASAL_MIN_DB = 2
const NASAL_MAX_DB = 4
const NASAL_BW = 1.0
const NASAL_LO_HZ = 900
const NASAL_HI_HZ = 1600
const NASAL_BY_EAR_HZ = 1000

/**
 * Where a by-ear tweak goes for each perceived issue (nasal has its own band): the existing EQ slot and the direction
 * that fixes it, plus the BANDS index whose voice-over-room SNR limits a boost in a noisy room.
 */
const BY_EAR_SLOTS: Record<Exclude<FusedIssue['issue'], 'nasal'>, { type: EqBand['type']; freq: number; bw: number; dir: 1 | -1; snrBand: number }> = {
  muffled: { type: 'Band', freq: 450, bw: 1.2, dir: -1, snrBand: 3 },
  boomy: { type: 'Low Shelf', freq: 150, bw: 2.0, dir: -1, snrBand: 1 },
  thin: { type: 'Low Shelf', freq: 150, bw: 2.0, dir: 1, snrBand: 1 },
  harsh: { type: 'Band', freq: 3500, bw: 1.4, dir: -1, snrBand: 6 },
  sharpS: { type: 'High Shelf', freq: 10000, bw: 2.0, dir: -1, snrBand: 7 },
  dull: { type: 'High Shelf', freq: 10000, bw: 2.0, dir: 1, snrBand: 7 },
}

/** Insert keeping the EQ in frequency order (the list holds no notches yet). */
function insertByFreq(eq: SuggestedEqBand[], band: SuggestedEqBand): void {
  const i = eq.findIndex((e) => e.freq > band.freq)
  eq.splice(i < 0 ? eq.length : i, 0, band)
}

/**
 * Perceived issues on top of the measured EQ (SPEC "Voice goals (v0.9)"). Confirmed ones keep the full measured
 * correction, and nasal gets its band (-2..-4 dB, bw 1.0, centred toward the larger of the body/definition excess).
 * Not confirmed: a gentle 1.5 dB tweak in that direction, marked byEar, unless the measured band already goes that far.
 */
function applyPerceived(eq: SuggestedEqBand[], fused: readonly FusedIssue[], d: readonly number[], noBoost: (band: number) => boolean): void {
  const slotOf = (type: EqBand['type'], freq: number): number => eq.findIndex((e) => e.type === type && e.freq === freq)
  for (const f of fused) {
    if (f.issue === 'nasal') {
      const body = slotOf('Band', 1000)
      if (f.confirmed) {
        const bodyEx = Math.max(0, d[4] || 0)
        const defEx = Math.max(0, d[5] || 0)
        const t = bodyEx + defEx > 0 ? defEx / (bodyEx + defEx) : 0
        const freq = Math.round((NASAL_LO_HZ * (NASAL_HI_HZ / NASAL_LO_HZ) ** t) / 50) * 50
        const gain = -r05(clamp(f.delta * 0.7, NASAL_MIN_DB, NASAL_MAX_DB))
        // the nasal band takes over a body cut; a body boost (body below target) stays
        if (body >= 0 && eq[body].gain < 0) eq.splice(body, 1)
        insertByFreq(eq, { type: 'Band', freq, gain, bw: NASAL_BW, why: sx('why.nasal', { dev: f.delta }) })
      } else {
        if (body >= 0) eq.splice(body, 1)
        insertByFreq(eq, { type: 'Band', freq: NASAL_BY_EAR_HZ, gain: -BY_EAR_DB, bw: NASAL_BW, why: sx('why.byEar.nasal'), byEar: true })
      }
      continue
    }
    if (f.confirmed) continue
    const s = BY_EAR_SLOTS[f.issue]
    if (s.dir > 0 && noBoost(s.snrBand)) continue
    const i = slotOf(s.type, s.freq)
    // the measured band already corrects at least this much in that direction
    if (i >= 0 && eq[i].gain * s.dir >= BY_EAR_DB) continue
    const band: SuggestedEqBand = { type: s.type, freq: s.freq, gain: BY_EAR_DB * s.dir, bw: s.bw, why: sx(`why.byEar.${f.issue}`), byEar: true }
    if (i >= 0) eq[i] = band
    else insertByFreq(eq, band)
  }
}

/**
 * null when the base take could not be analyzed. `dist` is used only if the base take has no step distance.
 * `mic` defaults to the profile stored on the take; it only changes the wording of the noise hint.
 * `goal`: the EQ corrects toward the goal's target curve; perceived issues add their corrections (natural = the reference).
 */
export function suggest(base: Take, dist: string, mic: MicProfile | undefined = base.mic, goal: VoiceGoal = DEFAULT_GOAL): Suggestion | null {
  const a = base.analysis
  if (isAnalysisError(a)) return null
  const d = targetDeviations(a.rel, goal)
  const noisy = a.snr < NOISY_SNR
  const k = 0.7
  const eq: SuggestedEqBand[] = []
  /** `bandSnr` matters in a noisy room only: below 12 dB the band gets no boost; NaN = unknown, no clamp. */
  const add = (type: EqBand['type'], freq: number, gain: number, bw: number, why: Msg, bandSnr = NaN): void => {
    if (noisy && bandSnr < NO_BOOST_SNR) gain = Math.min(gain, 0)
    gain = r05(gain)
    if (Math.abs(gain) >= 1) eq.push({ type, freq, gain, bw, why })
  }
  add('Low Shelf', 150, clamp(-d[1] * k, -8, 2), 2.0, sm('why.boom', { dev: d[1] }), at(a.bandSnr, 1))
  add('Band', 250, clamp(-d[2] * k, -6, 3), 1.5, sm('why.warmth', { dev: d[2] }), at(a.bandSnr, 2))
  add('Band', 450, clamp(-d[3] * k, -5, 3), 1.2, sm('why.mud', { dev: d[3] }), at(a.bandSnr, 3))
  add('Band', 1000, clamp(-d[4] * k, -4, 4), 1.5, sm('why.body', { dev: d[4] }), at(a.bandSnr, 4))
  add('Band', 3500, clamp(-d[6] * k, -4, 5), 1.4, sm('why.presence', { dev: d[6] }), at(a.bandSnr, 6))
  const snr7 = at(a.bandSnr, 7)
  const snr8 = at(a.bandSnr, 8)
  if (noisy && snr7 < 10 && snr8 < 10) {
    // The room beats the voice above 5 kHz: a gentle cut instead of a lift.
    add('High Shelf', 10000, snr7 < 5 && snr8 < 5 ? -4 : -2, 2.0, sm('why.roomAbove5k'))
  } else {
    // On a noisy input a big high shelf mostly lifts the hiss: cap it at +2 dB.
    add('High Shelf', 10000, clamp(-((d[7] + d[8]) / 2) * k, -4, noisy ? 2 : 5), 2.0, sm('why.top', { sib: d[7], air: d[8] }), Math.min(snr7, snr8))
  }
  const fused = fusePerceived(a, goal)
  if (fused.length) applyPerceived(eq, fused, d, (i) => noisy && at(a.bandSnr, i) < NO_BOOST_SNR)
  if (noisy) eq.push(...notches(a.tones))
  const lowcut: 80 | 120 = d[0] > 3 ? 120 : 80
  const gate: Suggestion['gate'] = noisy
    ? // Soft expander after noise reduction: it sees the processed, quieter voice, so it sits 30 dB under the speech
      // level (SPEC "Refinement loop (v1.1)"); a threshold near the raw room level closed on the voice.
      { threshold: Math.round(clamp(a.speechMed - 30, -72, -45)), attack: 1, hold: 200, release: 300, hysteresis: -6, wet: 0, dry: -10 }
    : // The gate must open above the noise floor or it never closes.
      { threshold: Math.round(clamp(Math.max(Math.min(a.noise + 12, a.speechMed - 25), a.noise + 6), -72, -30)), attack: 1, hold: 150, release: 200, hysteresis: -6, wet: 0, dry: -20 }
  const cThr = Math.round(clamp(a.speechMed - (noisy ? 4 : 6), -45, -12))
  const ratio = noisy ? 2.5 : 3
  const outLvl = cThr + (a.speechMed - cThr) / ratio
  // Noisy room: makeup aims for -20 dBFS but never lifts the reduced room (noise - 10) above -45 dBFS.
  const makeupCap = noisy ? Math.max(0, -(a.noise - 10) - 45) : Infinity
  const makeup = Math.round(clamp(Math.min(-20 - outLvl, makeupCap), 0, 18))
  const deess = a.sibP95 > -6 || d[7] + (eq.find((e) => e.type === 'High Shelf')?.gain || 0) > 3
  const gainHint =
    a.speechMed < -35
      ? sm('gainQuiet', { speech: a.speechMed, db: Math.round(-30 - a.speechMed) })
      : a.speechMed > -14
        ? sm('gainHot', { speech: a.speechMed, db: Math.round(a.speechMed + 20) })
        : null
  const noiseHint: Msg[] = noisy
    ? [
        sm('noisy', { noise: a.noise, snr: a.snr }),
        placementTip(mic ?? DEFAULT_MIC),
        sm('noisyNext'),
        ...(mic?.kind === 'condenser' ? [sm('condenser')] : []),
      ]
    : []
  return {
    base,
    gainHint,
    noiseHint,
    dist: STEPS.find((s) => s.key === base.step)?.dist || dist || 'your distance',
    lowcut,
    gate,
    eq,
    comp: { threshold: cThr, ratio, attack: 5, release: 100, knee: 6, wet: makeup, limit: true },
    deess,
    noisyRoom: noisy,
    noiseReduction: noisy ? reafirPlan(a.snr) : null,
    chain: [...(noisy ? NOISY_CHAIN : QUIET_CHAIN)],
  }
}

function baseAnalysis(s: Suggestion): Analysis {
  const a = s.base.analysis
  if (isAnalysisError(a)) throw new Error('Suggestion base take has no analysis')
  return a
}

/** Sentences of a hint as one paragraph. */
export const joinMsgs = (msgs: readonly Msg[], t: MsgTranslator): string => msgs.map(t).join(' ')

/**
 * Plain-text settings sheet (Copy as text / Download .txt). Plugin sections follow the chain order.
 * Without `t` it is English (the downloadable sheet stays locale-neutral); with the UI's translator it is localized.
 * Plugin and parameter names are never translated. `baseName` overrides the take name on the "Based on" line.
 */
export function suggestionToText(s: Suggestion, t: MsgTranslator = englishText, baseName: string = s.base.name): string {
  const a = baseAnalysis(s)
  const x = (key: string, params?: Msg['params']): string => t(msg(`engine.sheet.${key}`, params))
  const L: string[] = []
  L.push(
    x('title'),
    x('basedOn', { name: baseName, speech: a.speechMed, noise: a.noise }),
    [x('keepMic', { dist: s.dist }), t(addressTip(s.base.mic ?? DEFAULT_MIC)), x('keepGain')].join(' '),
    '',
  )
  if (s.noiseHint.length) L.push(x('first', { text: joinMsgs(s.noiseHint, t) }), '')
  if (s.gainHint) L.push(x('first', { text: t(s.gainHint) }), '')
  const nr = s.noiseReduction
  const ai = !!nr?.preferAi
  const optional = t(msg('suggestx.sheet.optional'))
  const chain = s.chain.map((p) => (ai && p === nr?.plugin ? `${p} ${optional}` : p))
  L.push(x('hardware'), `  Lowcut Filter: on, ${s.lowcut} Hz`, '', x('order', { chain: chain.join(' → ') }), '')
  const steps = nr ? nr.steps.map((m, i) => `  ${i + 1}. ${t(m)}`) : []
  const list = nr ? nr.alternatives.map(t).join(', ') : ''
  if (nr && ai)
    L.push(t(msg('suggestx.sheet.tryFirst', { list })), '', t(msg('suggestx.sheet.noiseReductionOptional', { plugin: nr.plugin })), ...steps, '')
  else if (nr) L.push(x('noiseReduction', { plugin: nr.plugin }), ...steps, '  ' + x('alternatives', { list }), '')
  const g = s.gate
  const c = s.comp
  const sections: Record<string, () => void> = {
    ReaGate: () => L.push('ReaGate', `  Threshold: ${g.threshold} dB`, `  Attack: ${g.attack} ms`, `  Hold: ${g.hold} ms`, `  Release: ${g.release} ms`, `  Hysteresis: ${g.hysteresis} dB`, `  Wet: ${g.wet} dB`, `  Dry: ${g.dry} dB`, ''),
    ReaEQ: () => {
      L.push(x('eq'))
      if (!s.eq.length) L.push('  ' + x('eqNone'))
      s.eq.forEach((e, i) =>
        L.push('  ' + x('eqBand', { n: i + 1, type: e.type, notch: isNotch(e) ? ' ' + x('notch') : e.byEar ? ' ' + x('byEar') : '', freq: e.freq, gain: e.gain, bw: e.bw, why: t(e.why) })),
      )
      L.push('')
    },
    ReaComp: () => L.push('ReaComp', `  Threshold: ${c.threshold} dB`, `  Ratio: ${c.ratio}:1`, `  Attack: ${c.attack} ms`, `  Release: ${c.release} ms`, `  Knee size: ${c.knee} dB`, `  Wet (makeup): ${sg(c.wet)} dB`, '  Limit output: on', ''),
  }
  for (const name of s.chain) sections[name]?.()
  L.push(x(s.deess ? 'deessOn' : 'deessOff'), x(s.noiseReduction ? 'offNoisy' : 'offQuiet'))
  return L.join('\n')
}

/** English form of the noise-reduction plan (settings JSON, community summaries). */
const planToJson = (nr: NoiseReductionGuide): NoiseReductionPlan => ({
  plugin: nr.plugin,
  steps: nr.steps.map(englishText),
  alternatives: nr.alternatives.map(englishText),
  preferAi: nr.preferAi,
})

/** Object for Download .json: base replaced by basedOn/speechDbfs/noiseDbfs, prototype key order, then noisyRoom/noiseReduction/chain. Text is English. */
export function suggestionToJson(s: Suggestion): SuggestionJson {
  const a = baseAnalysis(s)
  return {
    basedOn: s.base.name,
    speechDbfs: +a.speechMed.toFixed(1),
    noiseDbfs: +a.noise.toFixed(1),
    gainHint: s.gainHint ? englishText(s.gainHint) : '',
    noiseHint: joinMsgs(s.noiseHint, englishText),
    dist: s.dist,
    lowcut: s.lowcut,
    gate: s.gate,
    eq: s.eq.map((e): EqBand => ({ ...e, why: englishText(e.why) })),
    comp: s.comp,
    deess: s.deess,
    noisyRoom: s.noisyRoom,
    noiseReduction: s.noiseReduction ? planToJson(s.noiseReduction) : null,
    chain: s.chain,
  }
}
