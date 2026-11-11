// Decoder of the audio engine's binary stream frames (layout v1, desktop/src-tauri/src/audio/frame.rs). Framework-free.
import type { AudioFrame } from './types'

export const AUDIO_FRAME_VERSION = 1
const HEADER_BYTES = 80

/** Decode one frame; null when the version or the size does not match. The sample arrays are copies. */
export function decodeAudioFrame(buf: ArrayBuffer): AudioFrame | null {
  if (buf.byteLength < HEADER_BYTES) return null
  const v = new DataView(buf)
  const u = (at: number) => v.getUint32(at, true)
  const f = (at: number) => v.getFloat32(at, true)
  if (u(0) !== AUDIO_FRAME_VERSION) return null
  const n = u(12)
  if (buf.byteLength !== HEADER_BYTES + 8 * n) return null
  const flags = u(20)
  return {
    seq: u(4),
    sampleRate: u(8),
    latencySamples: u(16),
    settled: (flags & 1) !== 0,
    latencyChanged: (flags & 2) !== 0,
    rawRmsDb: f(24),
    rawPeakDb: f(28),
    processedRmsDb: f(32),
    processedPeakDb: f(36),
    counters: {
      blocks: u(40),
      inputOverruns: u(44),
      outputUnderruns: u(48),
      monitorDropped: u(52),
      streamDropped: u(56),
      streamErrors: u(60),
      processP50Us: f(64),
      processP99Us: f(68),
      processMaxUs: f(72),
    },
    raw: new Float32Array(buf.slice(HEADER_BYTES, HEADER_BYTES + 4 * n)),
    processed: new Float32Array(buf.slice(HEADER_BYTES + 4 * n, HEADER_BYTES + 8 * n)),
  }
}
