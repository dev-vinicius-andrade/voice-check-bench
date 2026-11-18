// The steady tones of one whole signal (a recorded take): the live tone tracker (tones.ts) run once over all of it,
// with a window as long as the signal, as the take analyzer (take.ts) runs it. Pure, framework-free.
import { ToneTracker, type ToneFound } from './tones'

/**
 * Steady narrow tones (a whistle, coil whine, a hum's harmonic) present in nearly all of `samples`, strongest first
 * (ToneTracker's rules and limits; empty for a signal too short to judge).
 */
export function steadyTonesOf(samples: Float32Array, sampleRate: number): readonly ToneFound[] {
  if (!(sampleRate > 0) || !samples.length) return []
  // the window holds the whole signal: a tone must be present in nearly all of it, not only in its last 10 s
  const tracker = new ToneTracker(sampleRate, samples.length / sampleRate + 1)
  tracker.push(samples, samples.length)
  return tracker.tones()
}
