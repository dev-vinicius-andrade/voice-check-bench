// Test-only builders for community summaries (validate/aggregate tests and the --from-file fixture).
import { BANDS } from '../audio/reference'
import type { EqBand, StepKey } from '../types'
import type { CommunitySummary } from './types'

type TakeRow = CommunitySummary['takes'][number]

/** A take whose rel matches the reference curve plus `tilt` dB on the boom band (index 1). */
export function take(step: StepKey | null, snr: number, tilt = 0, noise = -60): TakeRow {
  return {
    step,
    analysis: {
      speechMed: noise + snr,
      noise,
      snr,
      rel: BANDS.map((b, i) => b.ref + (i === 1 ? tilt : 0)),
      bandSnr: BANDS.map(() => snr),
      tones: [],
      noiseKind: snr >= 30 ? 'quiet' : 'broadband',
      spread: 6,
      sibP95: -12,
    },
  }
}

export const eqBand = (type: EqBand['type'], freq: number, gain: number, bw = 1.5): EqBand => ({ type, freq, gain, bw, why: '' })

export function summary(model: string, takes: TakeRow[], eq: EqBand[] = [eqBand('Low Shelf', 150, -3, 2)], noisyRoom = false): CommunitySummary {
  return {
    app: 'voice-check-bench',
    version: 1,
    mic: { model, kind: 'dynamic', pattern: 'cardioid', address: 'end' },
    takes,
    suggestion: {
      speechDbfs: -24,
      noiseDbfs: -60,
      gainHint: '',
      noiseHint: '',
      dist: '8 cm',
      lowcut: 80,
      gate: { threshold: -48, attack: 1, hold: 150, release: 200, hysteresis: -6, wet: 0, dry: -20 },
      eq,
      comp: { threshold: -30, ratio: 3, attack: 5, release: 100, knee: 6, wet: 4, limit: true },
      deess: false,
      noisyRoom,
      noiseReduction: null,
      chain: ['ReaGate', 'ReaEQ', 'ReaComp'],
    },
  }
}
