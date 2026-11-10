// Test-only analyses for the plain-language engine.
import { BANDS } from '../audio/reference'
import { fakeAnalysis } from '../audio/testSignals'
import type { SuggestionJson } from '../settings/suggest'
import type { Analysis, AppliedSettings, MicProfile, StepKey, Take } from '../types'

/**
 * Reference `rel` with band i deviating by exactly d dB after level matching.
 * Bands 1..7 shift the matching offset, so they move by 7d/6 (the others then read -d/6); band 0 and 8 move by d.
 */
export function relWithDev(i: number, d: number): number[] {
  const rel = BANDS.map((b) => b.ref)
  rel[i] += i >= 1 && i <= 7 ? (d * 7) / 6 : d
  return rel
}

export const voiceAnalysis = (i: number, d: number, over: Partial<Analysis> = {}): Analysis =>
  fakeAnalysis({ rel: relWithDev(i, d), ...over })

/** A noisy room: SNR 10 dB, a strong fan tone, broadband floor. */
export const noisyAnalysis = (over: Partial<Analysis> = {}): Analysis =>
  fakeAnalysis({ noise: -42, snr: 10, tones: [{ hz: 1040, db: 16 }], noiseKind: 'tonal', ...over })

/**
 * A raw control in a noisy room and its over-processed version (noise removal far too strong): 18 dB quieter,
 * bass gone (boom/warmth deviation -15.7), presence pushed (+14.3), 40 % digital silence, 23 gate flips per 10 s.
 */
export function processedPair(over: Partial<Analysis> = {}): { raw: Analysis; fx: Analysis } {
  const raw = noisyAnalysis({ noise: -36, speechMed: -24, snr: 12 })
  const rel = BANDS.map((b) => b.ref)
  rel[1] -= 20
  rel[2] -= 20
  rel[6] += 10
  const fx = fakeAnalysis({ noise: -100, speechMed: -42, snr: 58, rel, zeroRatio: 0.4, gateSwitches: 23, ...over })
  return { raw, fx }
}

export const mic = (over: Partial<MicProfile> = {}): MicProfile => ({
  model: 'Test mic', kind: 'dynamic', pattern: 'cardioid', address: 'end', ...over,
})

/** A spread of analyses that exercises every rating label and most actions. */
export function fixtureAnalyses(): Analysis[] {
  const list: Analysis[] = [
    fakeAnalysis(),
    noisyAnalysis(),
    noisyAnalysis({ snr: 0, spread: 14, speechMed: -34, clip: 3 }),
    fakeAnalysis({ snr: 24, noise: -48, noiseKind: 'broadband' }),
    fakeAnalysis({ snr: 22, noise: -50, noiseKind: 'hum', hum: [{ hz: 50, db: 18 }] }),
    fakeAnalysis({ snr: 22, noise: -64, noiseKind: 'quiet' }),
    fakeAnalysis({ snr: 22, noiseKind: null as unknown as Analysis['noiseKind'], noiseBands: [], bandSnr: [], tones: [] }),
    fakeAnalysis({ speechMed: -30 }),
    fakeAnalysis({ speechMed: -40 }),
    fakeAnalysis({ speechMed: -14 }),
    fakeAnalysis({ speechMed: -8 }),
    fakeAnalysis({ peak: -0.5 }),
    fakeAnalysis({ clip: 12, peak: 0 }),
    fakeAnalysis({ sibP95: -3 }),
    fakeAnalysis({ spread: 12 }),
  ]
  for (let i = 1; i <= 8; i++) {
    for (const d of [-9, -5, 5, 9]) list.push(voiceAnalysis(i, d))
  }
  list.push(voiceAnalysis(1, 12, { snr: 12, noiseKind: 'broadband' }))
  list.push(voiceAnalysis(6, -12, { snr: 40, speechMed: -30 }))
  const wild = [-18, 20, 20, -20, 0, -30, 10, -40, -17]
  list.push(fakeAnalysis({ clip: 5, speechMed: -45, spread: 14 })) // ok.level
  list.push(fakeAnalysis({ clip: 5, speechMed: -45, spread: 30, snr: 12, noiseKind: 'broadband' })) // hard.level
  list.push(fakeAnalysis({ rel: wild, spread: 14 })) // ok.tone
  list.push(fakeAnalysis({ rel: wild, spread: 30, snr: 14, speechMed: -36, noiseKind: 'broadband' })) // hard.tone
  // over-processing (v0.8): good / warn / bad check, cut-to-silence noise rating, overprocessed headline
  list.push(fakeAnalysis({ zeroRatio: 0.01, gateSwitches: 2 }))
  list.push(fakeAnalysis({ gateSwitches: 8 }))
  list.push(processedPair().fx)
  return list
}

/** A guided take around an analysis (test-only). */
export const sessionTake = (id: number, step: StepKey, name: string, analysis: Analysis): Take => ({
  id, name, session: 's1', step, device: 'Mic', sampleRate: 48000, samples: new Float32Array(0), created: '2026-11-01T00:00:00.000Z', analysis,
})

/**
 * The real session behind the refinement loop (SPEC "Refinement loop (v1.1)", numbers from a shared summary): a noisy
 * room where 2 cm is boomy but loudest, 15 cm was picked as "best" by the old rule, and the processed take (at 15 cm)
 * came out 12 dB quieter, thin, harsh and chopped (38 % digital silence).
 */
export function realSession(): { c2: Take; c8: Take; c15: Take; fx: Take; settings: SuggestionJson; applied: AppliedSettings } {
  const raw = (speechMed: number, noise: number, snr: number, rel: number[]): Analysis =>
    fakeAnalysis({ speechMed, noise, snr, rel, noiseKind: 'broadband', tones: [{ hz: 1617, db: 18 }, { hz: 1559, db: 16 }, { hz: 768, db: 13 }] })
  const c2 = sessionTake(1, 'c2', 'Control · 2 cm · raw', raw(-20.8, -37, 16.3, [-10.6, 12.4, 16, 9.5, 0, -0.7, -5.4, -12.8, -26.4]))
  const c8 = sessionTake(2, 'c8', 'Control · 8 cm · raw', raw(-25.7, -37.1, 11.4, [-21.3, 5.7, 13.9, 5, 0, -0.1, -2, -13.6, -24.8]))
  const c15 = sessionTake(3, 'c15', 'Control · 15 cm · raw', raw(-29.2, -37.1, 7.9, [-11.4, 5.4, 9.9, 5.8, 0, 0.6, -4.6, -14.4, -29.3]))
  const fx = sessionTake(4, 'fx', 'Processed · 15 cm · Record Mix', fakeAnalysis({
    speechMed: -40.8, noise: -100, snr: 59.2, rel: [-39.8, -15.3, 15.5, 17.2, 0, 9.3, 13.8, 8.2, -4.7], zeroRatio: 0.38, gateSwitches: 23,
  }))
  const settings: SuggestionJson = {
    basedOn: 'Control · 15 cm · raw',
    speechDbfs: -29.2,
    noiseDbfs: -37.1,
    gainHint: '',
    noiseHint: 'The input is noisy.',
    dist: '15 cm',
    lowcut: 80,
    gate: { threshold: -41, attack: 1, hold: 200, release: 300, hysteresis: -6, wet: 0, dry: -10 },
    eq: [
      { type: 'Low Shelf', freq: 150, gain: -3.5, bw: 2, why: 'Boom' },
      { type: 'Band', freq: 250, gain: -4.5, bw: 1.5, why: 'Warmth' },
      { type: 'High Shelf', freq: 10000, gain: -4, bw: 2, why: 'Room above 5 kHz' },
      { type: 'Band', freq: 1617, gain: -9, bw: 0.1, why: 'Fan tone' },
      { type: 'Band', freq: 1559, gain: -8, bw: 0.1, why: 'Fan tone' },
      { type: 'Band', freq: 768, gain: -6.5, bw: 0.1, why: 'Fan tone' },
    ],
    comp: { threshold: -33, ratio: 2.5, attack: 5, release: 100, knee: 6, wet: 2, limit: true },
    deess: true,
    noisyRoom: true,
    noiseReduction: { plugin: 'ReaFIR', steps: ['Add ReaFIR'], alternatives: ['Elgato Noise Removal'], preferAi: true },
    chain: ['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate'],
  }
  const applied: AppliedSettings = { id: 'a1', date: '2026-11-01T00:00:00.000Z', settings, noiseRemoval: 'reafir', dist: '15 cm', attempt: 1 }
  return { c2, c8, c15, fx, settings, applied }
}
