// Browser side of live capture (SPEC "Live tuning (v1.3)"): opening an input by deviceId, the 'tap' worklet feeding a
// ring buffer, and mapping getUserMedia failures to LiveError codes. No React.
import { FloatRing } from './ring'
import { LIVE_BUFFER_SEC, type LiveError } from './types'

export const LIVE_SAMPLE_RATE = 48000
export const TAP_WORKLET_URL = `${import.meta.env.BASE_URL}worklets/tap-worklet.js`

/** Same capture as AudioEngine: no browser voice processing, the device's own sound. */
export const liveConstraints = (deviceId: string): MediaStreamConstraints => ({
  audio: {
    deviceId: { exact: deviceId },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: LIVE_SAMPLE_RATE },
  },
})

export function isLiveSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined'
  )
}

const errorName = (e: unknown): string =>
  typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string' ? e.name : ''

/** permission when the browser or the person blocked the microphone; otherwise that side's input is unavailable. */
export function startErrorCode(e: unknown, side: 'raw' | 'fx'): LiveError {
  const name = errorName(e)
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission'
  return side === 'raw' ? 'rawUnavailable' : 'fxUnavailable'
}

export const stopStream = (s: MediaStream): void => s.getTracks().forEach((t) => t.stop())

interface TapChunk {
  frame: number
  samples: Float32Array
}

const isTapChunk = (d: unknown): d is TapChunk =>
  typeof d === 'object' && d !== null && 'frame' in d && typeof d.frame === 'number' && 'samples' in d && d.samples instanceof Float32Array

/** One open input: its stream, the source → tap worklet nodes and the ring the worklet fills. */
export interface Tap {
  stream: MediaStream
  ring: FloatRing
  close(): void
}

/** Wires stream → tap worklet (→ `sink`, a muted gain) and fills a LIVE_BUFFER_SEC ring. The worklet module must be loaded. */
export function openTap(ctx: AudioContext, stream: MediaStream, sink: AudioNode): Tap {
  const ring = new FloatRing(Math.round(LIVE_BUFFER_SEC * ctx.sampleRate))
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
  node.port.onmessage = (e: MessageEvent<unknown>) => {
    if (isTapChunk(e.data)) ring.write(e.data.samples, e.data.frame)
  }
  source.connect(node)
  node.connect(sink)
  return {
    stream,
    ring,
    close() {
      node.port.onmessage = null
      source.disconnect()
      node.disconnect()
      stopStream(stream)
      ring.clear()
    },
  }
}
