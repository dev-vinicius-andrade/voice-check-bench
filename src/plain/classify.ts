// Hardware-agnostic problem classifier: turns an Analysis into a ranked list of problems with
// plain-language fix steps and optional actuator commands. Framework-free: no React, no Tauri.
// Thresholds reuse the same constants as diagnose.ts so the classifier agrees with the checks.
import type { Analysis, MicProfile, VoiceGoal } from '../types'
import { targetDeviations } from '../audio/reference'
import { STRONG_TONE_DB } from '../audio/analyze'
import { LEVEL_GOOD_MIN, LEVEL_GOOD_MAX } from '../audio/diagnose'
import { DEFAULT_MIC, placementTip } from '../mics/catalog'
import { hasAdapterFor, type ActuatorCommand } from './actuator'
import type { Msg } from './types'

const msg = (key: string, params?: Msg['params']): Msg => (params ? { key, params } : { key })

/** Broad categories that group specific problem kinds. */
export type ProblemCategory = 'noise' | 'gain' | 'tone'

/** Every distinct problem the classifier can report. */
export type ProblemKind =
  | 'roomHum' | 'fanTone' | 'broadbandHiss' | 'roomNoise'
  | 'tooQuiet' | 'tooLoud' | 'unevenLevel'
  | 'boomy' | 'muffled' | 'thin' | 'harsh' | 'sibilant' | 'dull'

/** One step toward fixing a problem: always has plain text, optionally has an actuator command. */
export interface FixStep {
  text: Msg
  /** Present only when a registered actuator can carry this out automatically. */
  actuator?: ActuatorCommand
}

/** A single detected problem with its severity, summary and ordered fix steps. */
export interface Problem {
  kind: ProblemKind
  category: ProblemCategory
  severity: 'bad' | 'warn'
  summary: Msg
  steps: FixStep[]
}

/** The full output of classify(): problems sorted by severity then impact, plus install flag. */
export interface ProblemReport {
  problems: Problem[]
  /** True when at least one fix step has an actuator command but no adapter is registered. */
  installOffer: boolean
}

// ---- thresholds (match diagnose.ts) ----
const NOISY_SNR = 25
const HUM_WARN_DB = 6
const HUM_BAD_DB = 12
const SPREAD_WARN = 8
const SPREAD_BAD = 12
const SIB_WARN = -6
const BAND_DEVIATION_WARN = 3
const BAND_DEVIATION_BAD = 6

/** Classify an analyzed take into hardware-agnostic problems with fix steps. */
export function classify(
  a: Analysis,
  mic: MicProfile | undefined,
  goal: VoiceGoal,
): ProblemReport {
  const problems: Problem[] = []
  const m = mic ?? DEFAULT_MIC
  const d = targetDeviations(a.rel, goal)

  // ---- noise problems ----
  if (a.hum.length > 0) {
    const w = a.hum.reduce((best, h) => (h.db > best.db ? h : best))
    if (w.db >= HUM_WARN_DB) {
      const sev: 'bad' | 'warn' = w.db >= HUM_BAD_DB ? 'bad' : 'warn'
      const cmd: ActuatorCommand = { type: 'eqCut', freqHz: Math.round(w.hz), gainDb: sev === 'bad' ? -12 : -6, bwOct: 0.1 }
      problems.push({
        kind: 'roomHum',
        category: 'noise',
        severity: sev,
        summary: msg('plain.classify.roomHum.summary', { hz: Math.round(w.hz) }),
        steps: [
          { text: msg('plain.classify.roomHum.step.placement') },
          { text: msg('plain.classify.roomHum.step.ground') },
          { text: msg('plain.classify.roomHum.step.notch'), actuator: cmd },
        ],
      })
    }
  }

  if (a.tones.length > 0) {
    const strong = a.tones.filter((t) => t.db >= STRONG_TONE_DB)
    if (strong.length > 0) {
      const top = strong[0]
      const cmd: ActuatorCommand = { type: 'eqCut', freqHz: Math.round(top.hz), gainDb: -Math.min(12, 6 + (top.db - 12) / 2), bwOct: 0.1 }
      problems.push({
        kind: 'fanTone',
        category: 'noise',
        severity: top.db >= 18 ? 'bad' : 'warn',
        summary: msg('plain.classify.fanTone.summary', { hz: Math.round(top.hz) }),
        steps: [
          { text: msg('plain.classify.fanTone.step.move') },
          { text: msg('plain.classify.fanTone.step.notch'), actuator: cmd },
        ],
      })
    }
  }

  if (a.noiseKind === 'broadband' && a.snr < NOISY_SNR) {
    const sev: 'bad' | 'warn' = a.snr < 15 ? 'bad' : 'warn'
    problems.push({
      kind: 'broadbandHiss',
      category: 'noise',
      severity: sev,
      summary: msg('plain.classify.broadbandHiss.summary', { snr: Math.round(a.snr) }),
      steps: [
        { text: placementTip(m) },
        { text: msg('plain.classify.broadbandHiss.step.osSuppression') },
        { text: msg('plain.classify.broadbandHiss.step.subtract'), actuator: { type: 'noiseSubtract', profileNote: 'broadband' } },
      ],
    })
  } else if (a.noiseKind !== 'quiet' && a.snr < NOISY_SNR && !problems.some((p) => p.kind === 'roomHum' || p.kind === 'fanTone')) {
    const sev: 'bad' | 'warn' = a.snr < 15 ? 'bad' : 'warn'
    problems.push({
      kind: 'roomNoise',
      category: 'noise',
      severity: sev,
      summary: msg('plain.classify.roomNoise.summary', { noise: Math.round(a.noise), snr: Math.round(a.snr) }),
      steps: [
        { text: placementTip(m) },
        { text: msg('plain.classify.roomNoise.step.environment') },
        { text: msg('plain.classify.roomNoise.step.gate'), actuator: { type: 'gate', thresholdDb: Math.round(Math.max(a.noise + 6, a.speechMed - 30)) } },
      ],
    })
  }

  // ---- gain problems ----
  if (a.speechMed < LEVEL_GOOD_MIN) {
    const sev: 'bad' | 'warn' = a.speechMed < -35 ? 'bad' : 'warn'
    problems.push({
      kind: 'tooQuiet',
      category: 'gain',
      severity: sev,
      summary: msg('plain.classify.tooQuiet.summary', { speech: Math.round(a.speechMed) }),
      steps: [
        { text: msg('plain.classify.tooQuiet.step.closer') },
        { text: msg('plain.classify.tooQuiet.step.osGain') },
        { text: msg('plain.classify.tooQuiet.step.compress'), actuator: { type: 'compress', thresholdDb: Math.round(a.speechMed - 6), ratio: 3 } },
      ],
    })
  } else if (a.speechMed > LEVEL_GOOD_MAX) {
    problems.push({
      kind: 'tooLoud',
      category: 'gain',
      severity: a.clip > 0 ? 'bad' : 'warn',
      summary: msg('plain.classify.tooLoud.summary', { speech: Math.round(a.speechMed) }),
      steps: [
        { text: msg('plain.classify.tooLoud.step.backOff') },
        { text: msg('plain.classify.tooLoud.step.osGain') },
      ],
    })
  }

  if (a.spread > SPREAD_WARN) {
    const sev: 'bad' | 'warn' = a.spread > SPREAD_BAD ? 'bad' : 'warn'
    problems.push({
      kind: 'unevenLevel',
      category: 'gain',
      severity: sev,
      summary: msg('plain.classify.unevenLevel.summary', { spread: Math.round(a.spread) }),
      steps: [
        { text: msg('plain.classify.unevenLevel.step.distance') },
        { text: msg('plain.classify.unevenLevel.step.compress'), actuator: { type: 'compress', thresholdDb: Math.round(a.speechMed - 6), ratio: 3 } },
      ],
    })
  }

  // ---- tone problems (spectral balance) ----
  const bandProblems: { kind: ProblemKind; idx: number; dev: number; sev: 'bad' | 'warn'; hi: boolean }[] = [
    { kind: 'boomy', idx: 1, dev: d[1], sev: Math.abs(d[1]) >= BAND_DEVIATION_BAD ? 'bad' : 'warn', hi: d[1] > 0 },
    { kind: 'muffled', idx: 3, dev: d[3], sev: Math.abs(d[3]) >= BAND_DEVIATION_BAD ? 'bad' : 'warn', hi: d[3] > 0 },
    { kind: 'thin', idx: 1, dev: d[1], sev: Math.abs(d[1]) >= BAND_DEVIATION_BAD ? 'bad' : 'warn', hi: d[1] < 0 },
    { kind: 'harsh', idx: 6, dev: d[6], sev: Math.abs(d[6]) >= BAND_DEVIATION_BAD ? 'bad' : 'warn', hi: d[6] > 0 },
    { kind: 'dull', idx: 7, dev: d[7], sev: Math.abs(d[7]) >= BAND_DEVIATION_BAD ? 'bad' : 'warn', hi: d[7] < 0 },
  ]

  for (const bp of bandProblems) {
    const absDev = Math.abs(bp.dev)
    if (absDev < BAND_DEVIATION_WARN) continue
    // thin and boomy share band 1; only emit the dominant direction
    if (bp.kind === 'thin' && d[1] > 0) continue
    if (bp.kind === 'boomy' && d[1] < 0) continue

    const FREQS: Record<string, number> = { boomy: 150, muffled: 450, thin: 150, harsh: 3500, dull: 10000 }
    const TYPES: Record<string, 'lowShelf' | 'highShelf' | 'eqBoost' | 'eqCut'> = {
      boomy: 'lowShelf', muffled: 'eqCut', thin: 'lowShelf', harsh: 'eqCut', dull: 'highShelf',
    }
    const freq = FREQS[bp.kind]
    const type = TYPES[bp.kind]
    const gain = bp.hi ? -Math.min(absDev * 0.7, 6) : Math.min(absDev * 0.7, 6)
    const cmd: ActuatorCommand = type === 'lowShelf' || type === 'highShelf'
      ? { type, freqHz: freq, gainDb: Math.round(gain * 2) / 2 }
      : { type, freqHz: freq, gainDb: Math.round(gain * 2) / 2, bwOct: 1.2 }

    problems.push({
      kind: bp.kind,
      category: 'tone',
      severity: bp.sev,
      summary: msg(`plain.classify.${bp.kind}.summary`, { dev: Math.round(bp.dev * 10) / 10 }),
      steps: [
        { text: msg(`plain.classify.${bp.kind}.step.physical`) },
        { text: msg(`plain.classify.${bp.kind}.step.eq`), actuator: cmd },
      ],
    })
  }

  if (a.sibP95 > SIB_WARN) {
    problems.push({
      kind: 'sibilant',
      category: 'tone',
      severity: 'warn',
      summary: msg('plain.classify.sibilant.summary', { sib: Math.round(a.sibP95) }),
      steps: [
        { text: msg('plain.classify.sibilant.step.angle') },
        { text: msg('plain.classify.sibilant.step.deess'), actuator: { type: 'deess' } },
      ],
    })
  }

  // Sort: bad before warn, then by category priority (noise > gain > tone)
  const catOrder: Record<ProblemCategory, number> = { noise: 0, gain: 1, tone: 2 }
  const sevOrder: Record<string, number> = { bad: 0, warn: 1 }
  problems.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || catOrder[a.category] - catOrder[b.category])

  // Check whether any fix step needs an actuator that isn't installed
  const installOffer = problems.some((p) =>
    p.steps.some((s) => s.actuator && !hasAdapterFor(s.actuator)),
  )

  return { problems, installOffer }
}