// Live input RMS level in dBFS (-120 when silent/off). Reads the engine on every animation frame while
// the mic is on and updates React state at most ~30 times per second.
import { useEffect, useState } from 'react'
import { useBench } from '../store/benchStore'
import { getEngine } from '../store/engine'

const FLOOR = -120
const FRAME_MS = 1000 / 30

export function useLevel(): number {
  const on = useBench((s) => s.mic.status === 'on')
  const [level, setLevel] = useState(FLOOR)

  useEffect(() => {
    if (!on) return
    let raf = 0
    let last = -Infinity
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      if (now - last < FRAME_MS) return
      last = now
      setLevel(getEngine().level())
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [on])

  return on ? level : FLOOR
}
