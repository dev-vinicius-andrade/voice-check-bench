// Room noise estimate for the setup screen: the minimum of the live input level over the last ~2 s.
// The quietest moment between words is the room, not the voice.
import { useEffect, useRef, useState } from 'react'
import { useLevel } from '../../hooks/useLevel'
import { useBench } from '../../store/benchStore'

const WINDOW_MS = 2000
const SAMPLE_MS = 100
/** useLevel() floor: no reading yet (mic off or before the first frame). */
const FLOOR = -120

/** Min dBFS over the last 2 s of the open input; null until 2 s of readings exist or while the mic is off. */
export function useRoomLevel(): number | null {
  const level = useLevel()
  const on = useBench((s) => s.mic.status === 'on')
  const deviceId = useBench((s) => s.mic.deviceId)
  const latest = useRef(level)
  const [room, setRoom] = useState<number | null>(null)

  useEffect(() => {
    latest.current = level
  }, [level])

  useEffect(() => {
    if (!on) return
    const win: { t: number; v: number }[] = []
    let started = false
    const id = window.setInterval(() => {
      const v = latest.current
      started ||= v > FLOOR
      if (!started) return
      const now = performance.now()
      win.push({ t: now, v })
      while (win.length > 0 && now - win[0].t > WINDOW_MS) win.shift()
      setRoom(now - win[0].t >= WINDOW_MS - SAMPLE_MS * 1.5 ? Math.min(...win.map((w) => w.v)) : null)
    }, SAMPLE_MS)
    return () => {
      window.clearInterval(id)
      setRoom(null)
    }
  }, [on, deviceId])

  return on ? room : null
}
