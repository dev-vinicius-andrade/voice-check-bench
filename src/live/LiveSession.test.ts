import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GOAL } from '../types'
import { startErrorCode } from './capture'
import { createLiveSession } from './LiveSession'
import type { LiveUpdate } from './tracker'
import { rawAndFx, voiceLike } from './liveTestSignals'
import { LIVE_UPDATE_MS, LiveStartError, type LiveError, type LiveMetrics } from './types'

class FakeTrack {
  stops = 0
  stop(): void {
    this.stops++
  }
}

class FakeStream {
  readonly track = new FakeTrack()
  constructor(readonly deviceId: string) {}
  getTracks(): FakeTrack[] {
    return [this.track]
  }
}

const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })

class FakeCtx {
  static all: FakeCtx[] = []
  readonly sampleRate = 48000
  readonly destination = {}
  readonly audioWorklet = { addModule: vi.fn(async () => undefined) }
  readonly resume = vi.fn(async () => undefined)
  readonly close = vi.fn(async () => undefined)
  constructor() {
    FakeCtx.all.push(this)
  }
  createMediaStreamSource(): ReturnType<typeof node> {
    return node()
  }
  createGain(): ReturnType<typeof node> & { gain: { value: number } } {
    return { ...node(), gain: { value: 1 } }
  }
}

class FakeWorkletNode {
  static all: FakeWorkletNode[] = []
  readonly port: { onmessage: ((e: { data: unknown }) => void) | null } = { onmessage: null }
  readonly connect = vi.fn()
  readonly disconnect = vi.fn()
  constructor() {
    FakeWorkletNode.all.push(this)
  }
  /** Delivers samples the way the tap worklet posts them. */
  feed(x: Float32Array, frame: number): void {
    for (let i = 0; i + 1024 <= x.length; i += 1024) this.port.onmessage?.({ data: { frame: frame + i, samples: x.slice(i, i + 1024) } })
  }
}

const deviceOf = (c: MediaStreamConstraints): string => {
  const a = c.audio
  if (typeof a !== 'object') return ''
  const d = a.deviceId
  return typeof d === 'object' && d !== null && !Array.isArray(d) && typeof d.exact === 'string' ? d.exact : ''
}

/** getUserMedia that fails for the device ids in `fail` with the given DOMException name. */
function stubMedia(fail: Record<string, string> = {}): FakeStream[] {
  const opened: FakeStream[] = []
  const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
    const id = deviceOf(c)
    if (fail[id]) throw new DOMException('nope', fail[id])
    const s = new FakeStream(id)
    opened.push(s)
    return s
  })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  return opened
}

const codeOf = async (p: Promise<unknown>): Promise<LiveError | 'none'> => {
  try {
    await p
    return 'none'
  } catch (e) {
    return e instanceof LiveStartError ? e.code : 'other'
  }
}

beforeEach(() => {
  FakeCtx.all = []
  FakeWorkletNode.all = []
  vi.stubGlobal('AudioContext', FakeCtx)
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
})

describe('createLiveSession start errors', () => {
  it('unsupported without getUserMedia or AudioWorkletNode', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    expect(await codeOf(createLiveSession(() => DEFAULT_GOAL).start({ rawId: 'raw', fxId: 'fx' }))).toBe('unsupported')
    stubMedia()
    vi.stubGlobal('AudioWorkletNode', undefined)
    expect(await codeOf(createLiveSession(() => DEFAULT_GOAL).start({ rawId: 'raw', fxId: 'fx' }))).toBe('unsupported')
  })

  it('sameDevice when both choices are the same input, before opening anything', async () => {
    const opened = stubMedia()
    expect(await codeOf(createLiveSession(() => DEFAULT_GOAL).start({ rawId: 'x', fxId: 'x' }))).toBe('sameDevice')
    expect(opened).toHaveLength(0)
    expect(FakeCtx.all).toHaveLength(0)
  })

  it('permission when the browser blocks the microphone', async () => {
    stubMedia({ raw: 'NotAllowedError' })
    expect(await codeOf(createLiveSession(() => DEFAULT_GOAL).start({ rawId: 'raw', fxId: 'fx' }))).toBe('permission')
    expect(FakeCtx.all[0].close).toHaveBeenCalledTimes(1)
  })

  it('rawUnavailable releases everything', async () => {
    stubMedia({ raw: 'NotReadableError' })
    expect(await codeOf(createLiveSession(() => DEFAULT_GOAL).start({ rawId: 'raw', fxId: 'fx' }))).toBe('rawUnavailable')
    expect(FakeCtx.all[0].close).toHaveBeenCalledTimes(1)
  })

  it('fxUnavailable stops the raw mic it already opened', async () => {
    const opened = stubMedia({ fx: 'OverconstrainedError' })
    expect(await codeOf(createLiveSession(() => DEFAULT_GOAL).start({ rawId: 'raw', fxId: 'fx' }))).toBe('fxUnavailable')
    expect(opened.map((s) => s.deviceId)).toEqual(['raw'])
    expect(opened[0].track.stops).toBe(1)
    expect(FakeCtx.all[0].close).toHaveBeenCalledTimes(1)
  })

  it('maps error names to codes', () => {
    expect(startErrorCode(new DOMException('', 'SecurityError'), 'fx')).toBe('permission')
    expect(startErrorCode(new DOMException('', 'NotFoundError'), 'raw')).toBe('rawUnavailable')
    expect(startErrorCode('weird', 'fx')).toBe('fxUnavailable')
  })
})

describe('createLiveSession running', () => {
  const source = voiceLike({ sec: 5, seed: 41 })
  const { raw, fx } = rawAndFx(source, 4.5 * 48000, { delayMs: 30, gainDb: 6 })

  it('emits metrics every update from both inputs, then stops cleanly (twice is fine)', async () => {
    const opened = stubMedia()
    const s = createLiveSession(() => DEFAULT_GOAL)
    const got: LiveMetrics[] = []
    s.subscribe((m) => got.push(m))
    await s.start({ rawId: 'raw', fxId: 'fx' })
    expect(FakeWorkletNode.all).toHaveLength(2)
    const [rawNode, fxNode] = FakeWorkletNode.all
    rawNode.feed(raw, 0)
    fxNode.feed(fx, 0)
    vi.advanceTimersByTime(LIVE_UPDATE_MS)
    expect(got).toHaveLength(1)
    expect(got[0].raw).not.toBeNull()
    expect(Math.abs((got[0].lagMs ?? 0) - 30)).toBeLessThan(5)
    expect(got[0].talkSec).toBeGreaterThan(1)

    s.stop()
    s.stop()
    expect(opened.every((st) => st.track.stops >= 1)).toBe(true)
    expect(FakeCtx.all[0].close).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(LIVE_UPDATE_MS * 4)
    expect(got).toHaveLength(1)
  })

  it('delivers held values, history and segments with every update; markChange starts a segment', async () => {
    stubMedia()
    const s = createLiveSession(() => DEFAULT_GOAL)
    const got: LiveUpdate[] = []
    const plain: LiveMetrics[] = []
    s.subscribe((m) => plain.push(m))
    s.subscribeUpdates((u) => got.push(u))
    s.markChange({ key: 'ignored.while.stopped' })
    await s.start({ rawId: 'raw', fxId: 'fx' })
    const [rawNode, fxNode] = FakeWorkletNode.all
    const half = 2.5 * 48000
    rawNode.feed(raw.subarray(0, half), 0)
    fxNode.feed(fx.subarray(0, half), 0)
    vi.advanceTimersByTime(LIVE_UPDATE_MS)
    s.markChange({ key: 'live.change.test' })
    rawNode.feed(raw.subarray(half - (half % 1024)), half - (half % 1024))
    fxNode.feed(fx.subarray(half - (half % 1024)), half - (half % 1024))
    vi.advanceTimersByTime(LIVE_UPDATE_MS)
    expect(got).toHaveLength(2)
    expect(plain).toEqual(got.map((u) => u.metrics))
    const u = got[1]
    expect(u.held.fx.heardAgoMs).toBe(0)
    expect(u.history.points.map((p) => p.t)).toEqual([LIVE_UPDATE_MS, 2 * LIVE_UPDATE_MS])
    expect(u.history.markers).toEqual([{ t: LIVE_UPDATE_MS, label: { key: 'live.change.test' } }])
    expect(u.segments.map((g) => g.label.key)).toEqual(['live.segment.start', 'live.change.test'])
    expect(u.segments[0].talkSec + u.segments[1].talkSec).toBeCloseTo(u.sinceStart.talkSec, 9)
    // the second window overlaps the first: only its new 2 s are added
    expect(u.sinceStart.talkSec).toBeLessThan(4.5 * 0.85)
    expect(u.sinceStart.talkSec).toBeGreaterThan(u.metrics.talkSec)
    expect(u.sinceStart.raw).not.toBeNull()
    s.stop()
    expect(s.report(DEFAULT_GOAL).segments).toHaveLength(2)
    await s.start({ rawId: 'raw', fxId: 'fx' })
    expect(s.report(DEFAULT_GOAL).segments).toHaveLength(1)
    expect(s.report(DEFAULT_GOAL).sinceStart.talkSec).toBe(0)
    s.stop()
  })

  it('runs on the Wave Link output alone and stays quiet until there is audio', async () => {
    const opened = stubMedia()
    const s = createLiveSession(() => DEFAULT_GOAL)
    const got: LiveMetrics[] = []
    s.subscribe((m) => got.push(m))
    await s.start({ rawId: null, fxId: 'fx' })
    expect(opened.map((st) => st.deviceId)).toEqual(['fx'])
    vi.advanceTimersByTime(LIVE_UPDATE_MS)
    expect(got).toHaveLength(0)
    FakeWorkletNode.all[0].feed(fx, 0)
    vi.advanceTimersByTime(LIVE_UPDATE_MS)
    expect(got).toHaveLength(1)
    expect(got[0].raw).toBeNull()
    s.stop()
  })

  it('a failing subscriber is logged once and does not stop the loop', async () => {
    stubMedia()
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const s = createLiveSession(() => DEFAULT_GOAL)
    const got: LiveMetrics[] = []
    s.subscribe(() => {
      throw new Error('boom')
    })
    const unsubscribe = s.subscribe((m) => got.push(m))
    await s.start({ rawId: null, fxId: 'fx' })
    FakeWorkletNode.all[0].feed(fx, 0)
    vi.advanceTimersByTime(LIVE_UPDATE_MS * 3)
    expect(got).toHaveLength(3)
    expect(err).toHaveBeenCalledTimes(1)
    unsubscribe()
    vi.advanceTimersByTime(LIVE_UPDATE_MS)
    expect(got).toHaveLength(3)
    s.stop()
  })

  it('stop() while starting releases what was opened and start resolves quietly', async () => {
    const opened = stubMedia()
    const s = createLiveSession(() => DEFAULT_GOAL)
    const p = s.start({ rawId: 'raw', fxId: 'fx' })
    s.stop()
    await expect(p).resolves.toBeUndefined()
    expect(opened.every((st) => st.track.stops >= 1)).toBe(true)
    expect(FakeCtx.all[0].close).toHaveBeenCalled()
    expect(FakeWorkletNode.all).toHaveLength(0)
  })
})
