// Fixture suggestions for the golden-file test of the exported settings sheet and JSON (suggestionToText /
// suggestionToJson must stay byte-identical English). Test-only.
import { fakeAnalysis } from '../audio/testSignals'
import type { Analysis, MicProfile, Take } from '../types'

const an = (over: Partial<Analysis> = {}): Analysis => ({
  ...fakeAnalysis(),
  speechBands: [],
  noiseBands: [],
  bandSnr: [],
  tones: [],
  noiseKind: 'quiet',
  ...over,
})

const take = (analysis: Analysis, mic?: MicProfile, step: Take['step'] = 'c8'): Take => ({
  id: 1,
  name: 'Control · 8 cm · raw',
  session: 's1',
  step,
  device: 'Mic',
  sampleRate: 48000,
  samples: new Float32Array(0),
  created: '2026-01-01T00:00:00.000Z',
  analysis,
  ...(mic ? { mic } : {}),
})

const noisy = (over: Partial<Analysis> = {}): Analysis =>
  an({
    noise: -40,
    speechMed: -22,
    snr: 18,
    speechBands: [-50, -38, -34, -32, -30, -36, -38, -44, -52],
    noiseBands: [-55, -46, -48, -42, -50, -58, -56, -52, -56],
    bandSnr: [5, 8, 14, 10, 20, 22, 18, 8, 4],
    tones: [
      { hz: 6200, db: 30 },
      { hz: 410.3, db: 22 },
      { hz: 1830, db: 13 },
      { hz: 900, db: 12 },
    ],
    noiseKind: 'tonal',
    sibP95: -3,
    ...over,
  })

/** name → [take, dist]. */
export const SHEET_FIXTURES: Record<string, [Take, string]> = {
  quietEq: [take(an({ rel: [-18 + 6, -4 + 10, -1, 2, 0, -6, -7 - 6, -11, -17], speechMed: -40 })), '8 cm'],
  hot: [take(an({ speechMed: -10 }), { model: 'X', kind: 'dynamic', pattern: 'cardioid', address: 'end' }), '8 cm'],
  noisyCondenserSide: [take(noisy(), { model: 'X', kind: 'condenser', pattern: 'supercardioid', address: 'side' }), '8 cm'],
  noisyLoud: [take(noisy({ snr: 12, noise: -30 }), { model: 'X', kind: 'dynamic', pattern: 'cardioid', address: 'end' }, 'c2'), '2 cm'],
  noisyOmniCut: [take(noisy({ bandSnr: [5, 8, 14, 10, 20, 22, 18, 4, 3] }), { model: 'X', kind: 'unknown', pattern: 'omni', address: 'unknown' }), '15 cm'],
}
