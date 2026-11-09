import { useEffect, useRef, useState, type RefObject } from 'react'

/** Scale (≤ 1) that fits a panel of natural `width` into the measured container (minus `pad` px); 1 without ResizeObserver. */
export function useFitScale(width: number, pad = 0): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // The observer reports the initial size right after observe().
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - pad
      setScale(w > 0 ? Math.min(1, w / width) : 1)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, pad])
  return [ref, scale]
}
