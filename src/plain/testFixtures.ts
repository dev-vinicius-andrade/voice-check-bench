// Test-only analyses for the plain-language engine.
import { BANDS } from '../audio/reference'
import { fakeAnalysis } from '../audio/testSignals'
import type { Analysis, MicProfile } from '../types'

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
