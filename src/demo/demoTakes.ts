// The example session behind "See an example result": four synthetic takes in a room with a steady
// fan (780/1560 Hz). 2 cm is boomy, 8 cm balanced, 15 cm thinner and noisier, the processed take cleaner.
// Built and analyzed in memory only; never saved (benchStore skips the 'demo' session).
import { analyze } from '../audio/analyze'
import { STEPS, fillDistance } from '../session/steps'
import type { MicProfile, StepKey, Take } from '../types'
import { demoSamples, type DemoSignal, type Sine } from './demoSignals'

export const DEMO_SESSION = 'demo'

export const DEMO_MIC: MicProfile = { model: 'Example dynamic mic', kind: 'dynamic', pattern: 'cardioid', address: 'end' }

const SAMPLE_RATE = 48000
/** Sine frequencies, one per reference octave band (40 Hz … 16 kHz). */
const HZ = [60, 115, 225, 450, 900, 1800, 3550, 7100, 12500]
/** Reference curve levels (BANDS[].ref): a voice at these levels has ~0 dB deviation. */
const REF = [-18, -4, -1, 2, 0, -6, -7, -11, -17]

const voice = (adjust: readonly number[]): Sine[] => HZ.map((hz, i) => ({ hz, db: REF[i] + (adjust[i] ?? 0) }))
const fan = (db: number): Sine[] => [
  { hz: 780, db },
  { hz: 1560, db: db - 4 },
]

const SPECS: Record<StepKey, Omit<DemoSignal, 'sampleRate'>> = {
  c2: { speechSec: 9, noiseDb: -56, speechDb: -21, seed: 11, voice: voice([2, 9, 6, 3]), tones: fan(-55) },
  c8: { speechSec: 9, noiseDb: -56, speechDb: -27.5, seed: 12, voice: voice([]), tones: fan(-55) },
  c15: { speechSec: 9, noiseDb: -53, speechDb: -31, seed: 13, voice: voice([-3, -6, -4, -1, 0, 1, 2, 2, 2]), tones: fan(-55) },
  fx: { speechSec: 9, noiseDb: -72, speechDb: -20, seed: 14, voice: voice([0, -1, 0, -1, 0, 1, 1]), tones: fan(-80) },
}

/** The processed take is named after the balanced control distance. */
const FX_DIST = '8 cm'

/** Builds and analyzes the four demo takes. Ids sit just below `now` so they sort as the newest session. */
export function buildDemoTakes(now: number = Date.now()): Take[] {
  return STEPS.map((st, i): Take => {
    const samples = demoSamples({ ...SPECS[st.key], sampleRate: SAMPLE_RATE })
    return {
      id: now - STEPS.length + i,
      name: fillDistance(st.title, FX_DIST),
      session: DEMO_SESSION,
      step: st.key,
      device: st.dev === 'raw' ? 'Example mic input' : 'Example effects mix',
      sampleRate: SAMPLE_RATE,
      samples,
      created: new Date(now - (STEPS.length - i) * 60_000).toISOString(),
      mic: { ...DEMO_MIC },
      analysis: analyze(samples, SAMPLE_RATE),
    }
  })
}
