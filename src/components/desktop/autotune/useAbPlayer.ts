import { useCallback, useEffect, useRef, useState } from 'react'
import { forPlayback } from '../../../desktop/autotune/results'

export type AbSide = 'before' | 'after'

/** What "Noise only" plays instead of the take and its render: only the moments without talking, of each side. */
export interface NoisePair {
  before: Float32Array
  after: Float32Array
}

export interface AbPlayer {
  /** Web Audio is there. */
  supported: boolean
  side: AbSide
  playing: boolean
  /** Where the take is, seconds (kept while paused; 0 after Stop or the end). */
  position: number
  /** Length of the picked side, seconds (of its noise-only audio in "Noise only"). */
  duration: number
  /** "Noise only" can be switched on (there is noise-only audio). */
  canNoiseOnly: boolean
  /** Before / After play the noise-only audio instead of the take and its render. */
  noiseOnly: boolean
  /** Switch "Noise only": playback stops and goes back to the start. */
  setNoiseOnly(on: boolean): void
  /** Play or pause the picked side. */
  toggle(): void
  /** Stop and go back to the start. */
  stop(): void
  /** Go to `sec` (clamped to the take); while playing it plays on from there. */
  seek(sec: number): void
  /** Pick a side; while playing it switches at the same moment of the take. */
  pick(side: AbSide): void
}

interface Playing {
  src: AudioBufferSourceNode
  /** ctx.currentTime at which position 0 of the take would have played. */
  t0: number
}

/** How often the shown position follows the playback, ms. */
export const TICK_MS = 100

const ctxClass = (): typeof AudioContext | null => (typeof window !== 'undefined' && 'AudioContext' in window ? window.AudioContext : null)

/**
 * Before / After of the same take through Web Audio: one plays at a time, switching keeps the position (instant A/B).
 * With `noise`, "Noise only" plays its two sides instead (same switch, same controls).
 */
export function useAbPlayer(before: Float32Array, after: Float32Array, noise: NoisePair | null = null, sampleRate = 48000): AbPlayer {
  const ctx = useRef<AudioContext | null>(null)
  /** Decoded playback buffers per mode and side, each with the samples it was made from (new samples → a new buffer). */
  const buffers = useRef<Partial<Record<string, { from: Float32Array; buf: AudioBuffer }>>>({})
  const now = useRef<Playing | null>(null)
  const pos = useRef(0)
  const [side, setSide] = useState<AbSide>('after')
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [noiseMode, setNoiseMode] = useState(false)
  const noiseOnly = noiseMode && noise !== null
  /** The samples a side plays now. */
  const srcOf = (s: AbSide): Float32Array => (noiseOnly && noise ? noise[s] : s === 'before' ? before : after)
  const duration = srcOf(side).length / sampleRate

  /** The playing position, or the kept one. */
  const current = (): number => {
    const p = now.current
    return p && ctx.current ? Math.max(0, ctx.current.currentTime - p.t0) : pos.current
  }

  const halt = useCallback((): void => {
    const p = now.current
    now.current = null
    if (!p) return
    p.src.onended = null
    if (ctx.current) pos.current = Math.max(0, ctx.current.currentTime - p.t0)
    try {
      p.src.stop()
    } catch {
      // already stopped
    }
  }, [])

  useEffect(
    () => () => {
      halt()
      ctx.current?.close().catch(() => undefined)
      ctx.current = null
    },
    [halt],
  )

  // the shown position follows the playback
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      const p = now.current
      if (p && ctx.current) setPosition(Math.max(0, ctx.current.currentTime - p.t0))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [playing])

  const startAt = (s: AbSide): void => {
    const C = ctxClass()
    if (!C) return
    const c = (ctx.current ??= new C())
    void c.resume?.()
    const from = srcOf(s)
    const key = `${noiseOnly ? 'noise' : 'take'}:${s}`
    let buf = buffers.current[key]?.from === from ? buffers.current[key]?.buf : undefined
    if (!buf) {
      const x = forPlayback(from)
      buf = c.createBuffer(1, Math.max(1, x.length), sampleRate)
      buf.copyToChannel(x, 0)
      buffers.current[key] = { from, buf }
    }
    const offset = pos.current < buf.duration ? pos.current : 0
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    const p: Playing = { src, t0: c.currentTime - offset }
    src.onended = () => {
      if (now.current !== p) return
      now.current = null
      pos.current = 0
      setPosition(0)
      setPlaying(false)
    }
    src.start(0, offset)
    now.current = p
    setPosition(offset)
    setPlaying(true)
  }

  const stop = (): void => {
    halt()
    pos.current = 0
    setPosition(0)
    setPlaying(false)
  }

  // new samples for the side that plays (a new render of After, or its noise-only audio): the sound switches to them at
  // the same position; paused, the next Play builds its buffer from them (startAt). The mode changing (also "Noise only"
  // no longer available) stops and goes back to the start instead.
  const playsBefore = srcOf('before')
  const playsAfter = srcOf('after')
  const played = useRef({ before: playsBefore, after: playsAfter, noiseOnly })
  const restart = useRef<(s: AbSide) => void>(() => undefined)
  const rewind = useRef<() => void>(() => undefined)
  useEffect(() => {
    restart.current = (s) => {
      if (!now.current || s !== side) return
      halt()
      startAt(s)
    }
    rewind.current = stop
  })
  useEffect(() => {
    const was = played.current
    played.current = { before: playsBefore, after: playsAfter, noiseOnly }
    if (was.noiseOnly !== noiseOnly) return rewind.current()
    for (const s of ['before', 'after'] as const) if (was[s] !== played.current[s]) restart.current(s)
  }, [playsBefore, playsAfter, noiseOnly])

  const toggle = (): void => {
    if (now.current) {
      halt()
      setPosition(pos.current)
      setPlaying(false)
    } else startAt(side)
  }

  const seek = (sec: number): void => {
    const to = Number.isFinite(sec) ? Math.min(Math.max(0, sec), duration) : 0
    const wasPlaying = now.current !== null
    halt()
    pos.current = to
    setPosition(to)
    if (wasPlaying) startAt(side)
  }

  const pick = (s: AbSide): void => {
    setSide(s)
    if (now.current && s !== side) {
      halt()
      startAt(s)
    } else if (!now.current) setPosition(current())
  }

  const setNoiseOnly = (on: boolean): void => {
    stop()
    setNoiseMode(on)
  }

  return { supported: ctxClass() !== null, side, playing, position, duration, canNoiseOnly: noise !== null, noiseOnly, setNoiseOnly, toggle, stop, seek, pick }
}
