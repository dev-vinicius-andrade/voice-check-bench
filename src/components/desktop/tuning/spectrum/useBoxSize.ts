import { useEffect, useState } from 'react'

export interface BoxSize {
  w: number
  h: number
}

/**
 * An element's size in CSS px, followed with a ResizeObserver: [callback ref, size]. `fallback` until it has been
 * measured (or where it can't be). A callback ref, so an element that mounts later (the plot on Start) is measured.
 */
export function useBoxSize<E extends HTMLElement>(fallback: BoxSize): [(el: E | null) => void, BoxSize] {
  const [node, setNode] = useState<E | null>(null)
  const [size, setSize] = useState<BoxSize | null>(null)
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize((s) => (s && s.w === width && s.h === height ? s : { w: width, h: height }))
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [node])
  return [setNode, size ?? fallback]
}
