// Test-only: a take cut into the engine's 100 ms stream frames (what audio_start delivers to onFrame).
import type { AudioFrame } from '../types'

const N = 4800

export function testFrames(take: Float32Array, fromSeq = 0): AudioFrame[] {
  const out: AudioFrame[] = []
  for (let k = 0; k * N < take.length; k++) {
    const raw = take.slice(k * N, (k + 1) * N)
    out.push({
      seq: fromSeq + k,
      sampleRate: 48000,
      latencySamples: 480,
      settled: true,
      latencyChanged: false,
      rawRmsDb: -30,
      rawPeakDb: -10,
      processedRmsDb: -30,
      processedPeakDb: -10,
      counters: { blocks: k * 10, inputOverruns: 0, outputUnderruns: 0, monitorDropped: 0, streamDropped: 0, streamErrors: 0, processP50Us: 1, processP99Us: 2, processMaxUs: 3 },
      raw,
      processed: raw.slice(),
    })
  }
  return out
}
