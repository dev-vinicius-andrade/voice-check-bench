// Live tuning engine (SPEC "Live tuning (v1.3)"): listens to the raw mic and the Wave Link output at once and emits
// fresh metrics + hints every LIVE_UPDATE_MS. Nothing is recorded or stored. No React.
import type { VoiceGoal } from '../types'
import { LiveAnalyzer } from './analyzer'
import { isLiveSupported, LIVE_SAMPLE_RATE, liveConstraints, openTap, startErrorCode, stopStream, TAP_WORKLET_URL, type Tap } from './capture'
import { LIVE_UPDATE_MS, LiveStartError, type LiveConfig, type LiveError, type LiveMetrics, type LiveSessionApi } from './types'

/** LiveStartError keeps the browser's own error as `cause` (its message is the code, for the UI). */
const startError = (code: LiveError, cause: unknown): LiveStartError => {
  const err = new LiveStartError(code)
  err.cause = cause
  return err
}

/** What a start() in progress has opened so far, released if it fails or stop() interrupts it. */
interface Opening {
  ctx: AudioContext | null
  streams: MediaStream[]
}

interface Running {
  ctx: AudioContext
  sink: GainNode
  raw: Tap | null
  fx: Tap
  timer: ReturnType<typeof setInterval>
}

const closeCtx = (ctx: AudioContext): void => {
  try {
    void ctx.close().catch(() => undefined)
  } catch {
    // already closed
  }
}

export function createLiveSession(getGoal: () => VoiceGoal): LiveSessionApi {
  const subs = new Set<(m: LiveMetrics) => void>()
  const analyzer = new LiveAnalyzer()
  let gen = 0
  let opening: Opening | null = null
  let run: Running | null = null
  let logged = false

  const logOnce = (e: unknown): void => {
    if (logged) return
    logged = true
    console.error('Live tuning update failed (further errors are not logged):', e)
  }

  const release = (o: Opening): void => {
    o.streams.forEach(stopStream)
    o.streams = []
    if (o.ctx) closeCtx(o.ctx)
    o.ctx = null
  }

  const tick = (): void => {
    if (!run) return
    let m: LiveMetrics | null = null
    try {
      m = analyzer.update(run.raw?.ring ?? null, run.fx.ring, run.ctx.sampleRate, getGoal())
    } catch (e) {
      logOnce(e)
    }
    if (!m) return
    for (const fn of subs) {
      try {
        fn(m)
      } catch (e) {
        logOnce(e)
      }
    }
  }

  const getStream = async (deviceId: string, side: 'raw' | 'fx'): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia(liveConstraints(deviceId))
    } catch (e) {
      throw startError(startErrorCode(e, side), e)
    }
  }

  function stop(): void {
    gen++
    if (opening) release(opening)
    opening = null
    if (!run) return
    const r = run
    run = null
    clearInterval(r.timer)
    r.raw?.close()
    r.fx.close()
    r.sink.disconnect()
    closeCtx(r.ctx)
  }

  async function start(cfg: LiveConfig): Promise<void> {
    stop()
    const my = gen
    if (!isLiveSupported()) throw new LiveStartError('unsupported')
    if (cfg.rawId !== null && cfg.rawId === cfg.fxId) throw new LiveStartError('sameDevice')
    const o: Opening = { ctx: null, streams: [] }
    opening = o
    // stop() during an await: it already released `o`; drop whatever arrived after and return quietly
    const aborted = (): boolean => my !== gen
    try {
      const ctx = new AudioContext({ sampleRate: LIVE_SAMPLE_RATE })
      o.ctx = ctx
      await ctx.audioWorklet.addModule(TAP_WORKLET_URL)
      if (aborted()) return release(o)
      const rawStream = cfg.rawId !== null ? await getStream(cfg.rawId, 'raw') : null
      if (rawStream) o.streams.push(rawStream)
      if (aborted()) return release(o)
      const fxStream = await getStream(cfg.fxId, 'fx')
      o.streams.push(fxStream)
      if (aborted()) return release(o)
      await ctx.resume()
      if (aborted()) return release(o)

      const sink = ctx.createGain()
      sink.gain.value = 0
      sink.connect(ctx.destination)
      const raw = rawStream ? openTap(ctx, rawStream, sink) : null
      const fx = openTap(ctx, fxStream, sink)
      analyzer.reset()
      logged = false
      opening = null
      run = { ctx, sink, raw, fx, timer: setInterval(tick, LIVE_UPDATE_MS) }
    } catch (e) {
      release(o)
      if (opening === o) opening = null
      if (aborted()) return
      if (e instanceof LiveStartError) throw e
      throw startError('other', e)
    }
  }

  return {
    start,
    stop,
    subscribe(fn) {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
  }
}
