import { useCallback, useEffect, useRef, useState } from 'react'
import { forPlayback } from '../../../desktop/autotune/results'

export type AbSide = 'before' | 'after'

export interface AbPlayer {
  /** Web Audio is there. */
  supported: boolean
  side: AbSide
  playing: boolean
  /** Play or pause the picked side. */
  toggle(): void
  /** Pick a side; while playing it switches at the same moment of the take. */
  pick(side: AbSide): void
}

interface Playing {
  src: AudioBufferSourceNode
  /** ctx.currentTime at which position 0 of the take would have played. */
  t0: number
}

const ctxClass = (): typeof AudioContext | null => (typeof window !== 'undefined' && 'AudioContext' in window ? window.AudioContext : null)

/** Before / After of the same take through Web Audio: one plays at a time, switching keeps the position (instant A/B). */
export function useAbPlayer(before: Float32Array, after: Float32Array, sampleRate = 48000): AbPlayer {
  const ctx = useRef<AudioContext | null>(null)
  /** Decoded playback buffers, each with the samples it was made from (new samples → a new buffer). */
  const buffers = useRef<Partial<Record<AbSide, { from: Float32Array; buf: AudioBuffer }>>>({})
  const now = useRef<Playing | null>(null)
  const pos = useRef(0)
  const [side, setSide] = useState<AbSide>('after')
  const [playing, setPlaying] = useState(false)

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

  const startAt = (s: AbSide): void => {
    const C = ctxClass()
    if (!C) return
    const c = (ctx.current ??= new C())
    void c.resume?.()
    const from = s === 'before' ? before : after
    let buf = buffers.current[s]?.from === from ? buffers.current[s]?.buf : undefined
    if (!buf) {
      const x = forPlayback(from)
      buf = c.createBuffer(1, Math.max(1, x.length), sampleRate)
      buf.copyToChannel(x, 0)
      buffers.current[s] = { from, buf }
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
      setPlaying(false)
    }
    src.start(0, offset)
    now.current = p
    setPlaying(true)
  }

  const toggle = (): void => {
    if (now.current) {
      halt()
      setPlaying(false)
    } else startAt(side)
  }

  const pick = (s: AbSide): void => {
    setSide(s)
    if (now.current && s !== side) {
      halt()
      startAt(s)
    }
  }

  return { supported: ctxClass() !== null, side, playing, toggle, pick }
}
