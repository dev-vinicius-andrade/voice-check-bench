// Suggested ReaPlugs settings ported 1:1 from the prototype (docs/prototype/voice-check.html). Pure.
// Built from a RAW take (the mic before any effects), at the distance you'll actually use.
import { f1 } from '../audio/diagnose'
import { deviations } from '../audio/reference'
import { bestControl } from '../session/bestControl'
import { STEPS } from '../session/steps'
import { isAnalysisError, type Analysis, type EqBand, type Suggestion, type Take } from '../types'

/** Exported settings JSON consumed by tools/apply-reaplugs.py (SPEC "Exported settings JSON"). */
export interface SuggestionJson {
  basedOn: string
  speechDbfs: number
  noiseDbfs: number
  gainHint: string
  dist: string
  lowcut: Suggestion['lowcut']
  gate: Suggestion['gate']
  eq: EqBand[]
  comp: Suggestion['comp']
  deess: boolean
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

/** null when the base take could not be analyzed. `dist` is used only if the base take has no step distance. */
export function suggest(base: Take, dist: string): Suggestion | null {
  const a = base.analysis
  if (isAnalysisError(a)) return null
  const d = deviations(a.rel)
  const k = 0.7
  const eq: EqBand[] = []
  const add = (type: EqBand['type'], freq: number, gain: number, bw: number, why: string): void => {
    gain = r05(gain)
    if (Math.abs(gain) >= 1) eq.push({ type, freq, gain, bw, why })
  }
  add('Low Shelf', 150, clamp(-d[1] * k, -8, 2), 2.0, `Boom ${f1(d[1])} dB on the raw mic`)
  add('Band', 250, clamp(-d[2] * k, -6, 3), 1.5, `Warmth ${f1(d[2])} dB`)
  add('Band', 450, clamp(-d[3] * k, -5, 3), 1.2, `Mud/box ${f1(d[3])} dB`)
  add('Band', 1000, clamp(-d[4] * k, -4, 4), 1.5, `Body ${f1(d[4])} dB`)
  add('Band', 3500, clamp(-d[6] * k, -4, 5), 1.4, `Presence ${f1(d[6])} dB`)
  add('High Shelf', 10000, clamp(-((d[7] + d[8]) / 2) * k, -4, 5), 2.0, `Sibilance ${f1(d[7])} / air ${f1(d[8])} dB`)
  const lowcut: 80 | 120 = d[0] > 3 ? 120 : 80
  const gThr = Math.round(clamp(Math.min(a.noise + 12, a.speechMed - 25), -72, -40))
  const cThr = Math.round(clamp(a.speechMed - 6, -45, -12))
  const ratio = 3
  const outLvl = cThr + (a.speechMed - cThr) / ratio
  const makeup = Math.round(clamp(-20 - outLvl, 0, 18))
  const deess = a.sibP95 > -6 || d[7] + (eq.find((e) => e.type === 'High Shelf')?.gain || 0) > 3
  const gainHint =
    a.speechMed < -35
      ? `The raw take is quiet (${a.speechMed.toFixed(0)} dBFS). Raise the Wave XLR gain about ${Math.round(-30 - a.speechMed)} dB first, then record the control takes again. The gate and compressor values depend on it.`
      : a.speechMed > -14
        ? `The raw take is hot (${a.speechMed.toFixed(0)} dBFS). Lower the Wave XLR gain about ${Math.round(a.speechMed + 20)} dB and record the control takes again.`
        : ''
  return {
    base,
    gainHint,
    dist: STEPS.find((s) => s.key === base.step)?.dist || dist || 'your distance',
    lowcut,
    gate: { threshold: gThr, attack: 1, hold: 150, release: 200, hysteresis: -6, wet: 0, dry: -20 },
    eq,
    comp: { threshold: cThr, ratio, attack: 5, release: 100, knee: 6, wet: makeup, limit: true },
    deess,
  }
}

function baseAnalysis(s: Suggestion): Analysis {
  const a = s.base.analysis
  if (isAnalysisError(a)) throw new Error('Suggestion base take has no analysis')
  return a
}

/** Plain-text settings sheet (Copy as text / Download .txt). */
export function suggestionToText(s: Suggestion): string {
  const a = baseAnalysis(s)
  const L: string[] = []
  L.push('Voice Check Bench · suggested settings', `Based on: ${s.base.name} (speech ${a.speechMed.toFixed(1)} dBFS, noise ${a.noise.toFixed(0)} dBFS)`, `Keep the mic at ${s.dist}, speak into the top, and leave the Wave XLR gain where it was for this take.`, '')
  if (s.gainHint) L.push('FIRST: ' + s.gainHint, '')
  L.push('Wave XLR (hardware)', `  Lowcut Filter: on, ${s.lowcut} Hz`, '', 'Effects order: ReaGate → ReaEQ → ReaComp', '')
  const g = s.gate
  L.push('ReaGate', `  Threshold: ${g.threshold} dB`, `  Attack: ${g.attack} ms`, `  Hold: ${g.hold} ms`, `  Release: ${g.release} ms`, `  Hysteresis: ${g.hysteresis} dB`, `  Wet: ${g.wet} dB`, `  Dry: ${g.dry} dB`, '')
  L.push('ReaEQ (use these bands only; remove or disable any others)')
  if (!s.eq.length) L.push('  No EQ needed: the raw mic is already close to the reference.')
  s.eq.forEach((e, i) => L.push(`  Band ${i + 1}: Type ${e.type} · Frequency ${e.freq} Hz · Gain ${sg(e.gain, e.gain.toFixed(1))} dB · Bandwidth ${e.bw.toFixed(2)} oct   (${e.why})`))
  const c = s.comp
  L.push('', 'ReaComp', `  Threshold: ${c.threshold} dB`, `  Ratio: ${c.ratio}:1`, `  Attack: ${c.attack} ms`, `  Release: ${c.release} ms`, `  Knee size: ${c.knee} dB`, `  Wet (makeup): ${sg(c.wet)} dB`, '  Limit output: on', '')
  L.push(`Elgato De-Esser: ${s.deess ? 'on (light)' : 'off'}`, 'Voice Focus, Elgato EQ, Elgato Noise Removal: off')
  return L.join('\n')
}

/** Object for Download .json: base replaced by basedOn/speechDbfs/noiseDbfs, key order as in the prototype. */
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
