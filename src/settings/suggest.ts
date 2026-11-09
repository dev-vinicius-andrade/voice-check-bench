// Suggested ReaPlugs settings ported 1:1 from the prototype (docs/prototype/voice-check.html). Pure.
// Built from a RAW take (the mic before any effects), at the distance you'll actually use.
// Noisy room (SNR < 25 dB, SPEC "Noisy-room mode"): ReaFIR noise reduction first, EQ without boosts in
// noisy bands plus tone notches, a gentler compressor and the gate as a soft expander at the end.
import { f1 } from '../audio/diagnose'
import { deviations } from '../audio/reference'
import { bestControl } from '../session/bestControl'
import { STEPS } from '../session/steps'
import { DEFAULT_MIC, addressTip, placementTip } from '../mics/catalog'
import {
  isAnalysisError,
  type Analysis,
  type EqBand,
  type MicProfile,
  type NoiseReductionPlan,
  type NoiseTone,
  type Suggestion,
  type Take,
} from '../types'

/** Exported settings JSON consumed by tools/apply-reaplugs.py (SPEC "Exported settings JSON"). */
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
export function pickSuggestionBase(slots: readonly (Take | null)[], fxDist: string | null): Take | null {
  const best = bestControl(slots)
  const dist = fxDist || best?.dist
  const atDist = slots.slice(0, 3).find((t, i) => isRawControl(t) && STEPS[i].dist === dist)
  return atDist ?? best?.take ?? null
}

const r05 = (v: number): number => Math.round(v * 2) / 2
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const sg = (v: number, text: string = String(v)): string => (v > 0 ? '+' : '') + text
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
export const isNotch = (e: EqBand): boolean => e.type === 'Band' && e.bw < 0.3

/** Manual ReaFIR setup (profiles can't be written to Wave Link). Stronger reduction when the voice is < 15 dB over the room. */
function reafirPlan(snr: number): NoiseReductionPlan {
  const amount = snr < 15 ? 'about 15 dB' : 'about 10–12 dB'
  return {
    plugin: 'ReaFIR',
    steps: [
      'In Wave Link → your mic → Effects, add "ReaFIR (ReaPlugs Edition)" and drag it to the top.',
      'Mode: Subtract. FFT size: 4096.',
      'Stay silent, tick "Automatically build noise profile" for about 3 seconds, then untick it.',
      `Drag the whole curve down until the room drops ${amount}. If your voice turns watery or robotic, back off.`,
      'Keep ReaEQ, ReaComp and ReaGate below ReaFIR, in that order.',
    ],
    alternatives: ['Elgato Noise Removal (in Wave Link)', 'Voice Focus by ai-coustics (in Wave Link)', 'NVIDIA Broadcast — Noise Removal (RTX GPUs)'],
  }
}

/** Notches for the strongest steady tones (>= 12 dB), at most 3: -6 dB at 12 dB, down to -12 dB at 24 dB and above. */
function notches(tones: readonly NoiseTone[] | undefined): EqBand[] {
  return (tones ?? [])
    .filter((t) => t.db >= 12)
    .sort((x, y) => y.db - x.db)
    .slice(0, MAX_NOTCHES)
    .map((t): EqBand => ({ type: 'Band', freq: Math.round(t.hz), gain: -r05(6 + Math.min(6, (t.db - 12) / 2)), bw: NOTCH_BW, why: `Fan/machine tone ${f1(t.db)} dB` }))
}

/**
 * null when the base take could not be analyzed. `dist` is used only if the base take has no step distance.
 * `mic` defaults to the profile stored on the take; it only changes the wording of the noise hint.
 */
export function suggest(base: Take, dist: string, mic: MicProfile | undefined = base.mic): Suggestion | null {
  const a = base.analysis
  if (isAnalysisError(a)) return null
  const d = deviations(a.rel)
  const noisy = a.snr < NOISY_SNR
  const k = 0.7
  const eq: EqBand[] = []
  /** `bandSnr` matters in a noisy room only: below 12 dB the band gets no boost; NaN = unknown, no clamp. */
  const add = (type: EqBand['type'], freq: number, gain: number, bw: number, why: string, bandSnr = NaN): void => {
    if (noisy && bandSnr < NO_BOOST_SNR) gain = Math.min(gain, 0)
    gain = r05(gain)
    if (Math.abs(gain) >= 1) eq.push({ type, freq, gain, bw, why })
  }
  add('Low Shelf', 150, clamp(-d[1] * k, -8, 2), 2.0, `Boom ${f1(d[1])} dB on the raw mic`, at(a.bandSnr, 1))
  add('Band', 250, clamp(-d[2] * k, -6, 3), 1.5, `Warmth ${f1(d[2])} dB`, at(a.bandSnr, 2))
  add('Band', 450, clamp(-d[3] * k, -5, 3), 1.2, `Mud/box ${f1(d[3])} dB`, at(a.bandSnr, 3))
  add('Band', 1000, clamp(-d[4] * k, -4, 4), 1.5, `Body ${f1(d[4])} dB`, at(a.bandSnr, 4))
  add('Band', 3500, clamp(-d[6] * k, -4, 5), 1.4, `Presence ${f1(d[6])} dB`, at(a.bandSnr, 6))
  const snr7 = at(a.bandSnr, 7)
  const snr8 = at(a.bandSnr, 8)
  if (noisy && snr7 < 10 && snr8 < 10) {
    // The room beats the voice above 5 kHz: a gentle cut instead of a lift.
    add('High Shelf', 10000, snr7 < 5 && snr8 < 5 ? -4 : -2, 2.0, 'Room noise dominates above 5 kHz')
  } else {
    // On a noisy input a big high shelf mostly lifts the hiss: cap it at +2 dB.
    add('High Shelf', 10000, clamp(-((d[7] + d[8]) / 2) * k, -4, noisy ? 2 : 5), 2.0, `Sibilance ${f1(d[7])} / air ${f1(d[8])} dB`, Math.min(snr7, snr8))
  }
  if (noisy) eq.push(...notches(a.tones))
  const lowcut: 80 | 120 = d[0] > 3 ? 120 : 80
  const gate: Suggestion['gate'] = noisy
    ? // Soft expander after noise reduction: opens 6 dB over the reduced room (estimate: noise - 10 dB).
      { threshold: Math.round(clamp(a.noise - 4, -72, -30)), attack: 1, hold: 200, release: 300, hysteresis: -6, wet: 0, dry: -10 }
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
      ? `The raw take is quiet (${a.speechMed.toFixed(0)} dBFS). Raise the Wave XLR gain about ${Math.round(-30 - a.speechMed)} dB first, then record the control takes again. The gate and compressor values depend on it.`
      : a.speechMed > -14
        ? `The raw take is hot (${a.speechMed.toFixed(0)} dBFS). Lower the Wave XLR gain about ${Math.round(a.speechMed + 20)} dB and record the control takes again.`
        : ''
  const condenser = mic?.kind === 'condenser' ? ' Condenser mics pick up more of the room: stay closer and lower the gain.' : ''
  const noiseHint = noisy
    ? `The input is noisy: the room/input noise (${a.noise.toFixed(0)} dBFS) is only ${a.snr.toFixed(0)} dB under your voice. No gate or EQ setting can separate them, and the gate would cut quiet words. Get the most out of the room: ${placementTip(mic ?? DEFAULT_MIC)} Speak closer and switch off what you can, then set up the noise-reduction step below before the EQ. Re-record the control takes to check: the closer to 30 dB, the cleaner.${condenser}`
    : ''
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

/** Plain-text settings sheet (Copy as text / Download .txt). Plugin sections follow the chain order. */
export function suggestionToText(s: Suggestion): string {
  const a = baseAnalysis(s)
  const L: string[] = []
  L.push('Voice Check Bench · suggested settings', `Based on: ${s.base.name} (speech ${a.speechMed.toFixed(1)} dBFS, noise ${a.noise.toFixed(0)} dBFS)`, `Keep the mic at ${s.dist}. ${addressTip(s.base.mic ?? DEFAULT_MIC)} Leave the Wave XLR gain where it was for this take.`, '')
  if (s.noiseHint) L.push('FIRST: ' + s.noiseHint, '')
  if (s.gainHint) L.push('FIRST: ' + s.gainHint, '')
  L.push('Wave XLR (hardware)', `  Lowcut Filter: on, ${s.lowcut} Hz`, '', `Effects order: ${s.chain.join(' → ')}`, '')
  const nr = s.noiseReduction
  if (nr) L.push(`${nr.plugin} (noise reduction)`, ...nr.steps.map((t, i) => `  ${i + 1}. ${t}`), `  Alternatives: ${nr.alternatives.join(', ')}`, '')
  const g = s.gate
  const c = s.comp
  const sections: Record<string, () => void> = {
    ReaGate: () => L.push('ReaGate', `  Threshold: ${g.threshold} dB`, `  Attack: ${g.attack} ms`, `  Hold: ${g.hold} ms`, `  Release: ${g.release} ms`, `  Hysteresis: ${g.hysteresis} dB`, `  Wet: ${g.wet} dB`, `  Dry: ${g.dry} dB`, ''),
    ReaEQ: () => {
      L.push('ReaEQ (use these bands only; remove or disable any others)')
      if (!s.eq.length) L.push('  No EQ needed: the raw mic is already close to the reference.')
      s.eq.forEach((e, i) => L.push(`  Band ${i + 1}: Type ${e.type}${isNotch(e) ? ' (notch)' : ''} · Frequency ${e.freq} Hz · Gain ${sg(e.gain, e.gain.toFixed(1))} dB · Bandwidth ${e.bw.toFixed(2)} oct   (${e.why})`))
      L.push('')
    },
    ReaComp: () => L.push('ReaComp', `  Threshold: ${c.threshold} dB`, `  Ratio: ${c.ratio}:1`, `  Attack: ${c.attack} ms`, `  Release: ${c.release} ms`, `  Knee size: ${c.knee} dB`, `  Wet (makeup): ${sg(c.wet)} dB`, '  Limit output: on', ''),
  }
  for (const name of s.chain) sections[name]?.()
  L.push(`Elgato De-Esser: ${s.deess ? 'on (light)' : 'off'}`, s.noiseReduction ? 'Elgato EQ: off. Use only one noise remover: ReaFIR, or one of the alternatives above (not both).' : 'Voice Focus, Elgato EQ, Elgato Noise Removal: off')
  return L.join('\n')
}

/** Object for Download .json: base replaced by basedOn/speechDbfs/noiseDbfs, prototype key order, then noisyRoom/noiseReduction/chain. */
export function suggestionToJson(s: Suggestion): SuggestionJson {
  const a = baseAnalysis(s)
  const { base, ...rest } = s
  return {
    basedOn: base.name,
    speechDbfs: +a.speechMed.toFixed(1),
    noiseDbfs: +a.noise.toFixed(1),
    ...rest,
  }
}
