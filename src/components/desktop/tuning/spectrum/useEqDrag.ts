import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { eqKey } from '../../../../desktop/advice/chain'
import type { EqField } from '../../../../desktop/advice/types'
import type { EqPoint } from '../../../../desktop/spectrum'
import { clampFreq, gainOfY, hzOfX, snapGain, stepFreq, stepWidth, xOfHz, yOfGain, type PlotBox } from './plotScale'

/** What the band handles change on the live chain: the chain state's own preview (throttled) and commit. */
export interface EqTarget {
  slot: number
  preview(slot: number, key: string, value: number): void
  commit(slot: number, key: string, value: number): void
}

type Live = Pick<EqPoint, 'n' | 'freqHz' | 'gainDb' | 'bwOct'>
/** A wheel turn is committed once it rests this long (one marker per turn, not per notch). */
const WHEEL_REST_MS = 400
const MOVED = ['freqHz', 'gainDb', 'bwOct'] as const

export interface EqDrag {
  /** The bands as shown: the one being dragged or turned at its live values. */
  shown: EqPoint[]
  /** Props of one band handle (pointer, keyboard, double-click). */
  bind(p: EqPoint): {
    onPointerDown(e: PointerEvent<Element>): void
    onPointerMove(e: PointerEvent<Element>): void
    onPointerUp(e: PointerEvent<Element>): void
    onPointerCancel(e: PointerEvent<Element>): void
    onKeyDown(e: KeyboardEvent<Element>): void
    onDoubleClick(): void
    onFocus(): void
  }
  /** One wheel notch over band `n` (deltaY < 0: narrower). */
  wheel(n: number, deltaY: number): void
  /** A final value typed or switched (the fields under the plot). */
  set(n: number, field: EqField, value: number): void
}

/**
 * Band handles → the live chain: drag x → frequency (log), y → gain (0.5 dB steps), both clamped, previewed while
 * moving and committed per changed key on release, so markers, Undo and Save see them like a slider move. Keys and
 * double-click commit at once; the wheel previews and commits when it rests.
 */
export function useEqDrag(target: EqTarget | null, points: readonly EqPoint[], box: PlotBox, svg: RefObject<SVGSVGElement | null>, onSelect: (n: number) => void): EqDrag {
  const [live, setLive] = useState<Live | null>(null)
  const liveRef = useRef<Live | null>(null)
  const grab = useRef<{ start: EqPoint; dx: number; dy: number } | null>(null)
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = (v: Live | null): void => {
    liveRef.current = v
    setLive(v)
  }

  const commitChanged = (start: EqPoint, now: Live): void => {
    if (!target) return
    for (const f of MOVED) if (Math.abs(now[f] - start[f]) > 1e-6) target.commit(target.slot, eqKey(start.n, f), now[f])
  }
  /** Commits a wheel turn (when it rests, a drag starts, or the plot goes away); reads the latest render's bands. */
  const finishWheel = useRef<() => void>(() => undefined)
  useEffect(() => {
    finishWheel.current = () => {
      if (!wheelTimer.current) return
      clearTimeout(wheelTimer.current)
      wheelTimer.current = null
      const now = liveRef.current
      const start = now && points.find((p) => p.n === now.n)
      if (now && start) commitChanged(start, now)
      show(null)
    }
  })
  useEffect(() => () => finishWheel.current(), [])

  const local = (e: PointerEvent<Element>) => {
    const r = svg.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  const draggable = (p: EqPoint): boolean => target !== null && p.type !== 'Other'
  const setNow = (n: number, field: EqField, value: number): void => target?.commit(target.slot, eqKey(n, field), value)

  const end = (e: PointerEvent<Element>): void => {
    const g = grab.current
    grab.current = null
    if (!g) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (liveRef.current) commitChanged(g.start, liveRef.current)
    show(null)
  }

  const bind: EqDrag['bind'] = (p) => ({
    onPointerDown: (e) => {
      onSelect(p.n)
      if (!draggable(p) || e.button > 0) return
      finishWheel.current()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const at = local(e)
      grab.current = { start: p, dx: at.x - xOfHz(box, p.freqHz), dy: at.y - yOfGain(box, p.gainDb) }
      show({ n: p.n, freqHz: p.freqHz, gainDb: p.gainDb, bwOct: p.bwOct })
    },
    onPointerMove: (e) => {
      const g = grab.current
      const prev = liveRef.current
      if (!g || !prev || !target) return
      const at = local(e)
      const next = { ...prev, freqHz: clampFreq(hzOfX(box, at.x - g.dx)), gainDb: snapGain(gainOfY(box, at.y - g.dy)) }
      if (next.freqHz !== prev.freqHz) target.preview(target.slot, eqKey(p.n, 'freqHz'), next.freqHz)
      if (next.gainDb !== prev.gainDb) target.preview(target.slot, eqKey(p.n, 'gainDb'), next.gainDb)
      show(next)
    },
    onPointerUp: end,
    onPointerCancel: end,
    onKeyDown: (e) => {
      if (!draggable(p)) return
      const step: Partial<Record<string, [EqField, number]>> = {
        ArrowLeft: ['freqHz', stepFreq(p.freqHz, -1)],
        ArrowRight: ['freqHz', stepFreq(p.freqHz, 1)],
        ArrowDown: ['gainDb', snapGain(p.gainDb - 0.5)],
        ArrowUp: ['gainDb', snapGain(p.gainDb + 0.5)],
        '[': ['bwOct', stepWidth(p.bwOct, -1)],
        ']': ['bwOct', stepWidth(p.bwOct, 1)],
        Delete: ['gainDb', 0],
      }
      const s = step[e.key]
      if (!s) return
      e.preventDefault()
      setNow(p.n, s[0], s[1])
    },
    onDoubleClick: () => {
      if (draggable(p)) setNow(p.n, 'gainDb', 0)
    },
    onFocus: () => onSelect(p.n),
  })

  const wheel = (n: number, deltaY: number): void => {
    const p = points.find((x) => x.n === n)
    if (!p || !draggable(p) || grab.current || deltaY === 0 || !target) return
    const cur = liveRef.current?.n === n ? liveRef.current : p
    const bwOct = stepWidth(cur.bwOct, deltaY < 0 ? -1 : 1)
    show({ n, freqHz: cur.freqHz, gainDb: cur.gainDb, bwOct })
    target.preview(target.slot, eqKey(n, 'bwOct'), bwOct)
    if (wheelTimer.current) clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => finishWheel.current(), WHEEL_REST_MS)
  }

  const shown = points.map((p) => (live && p.n === live.n ? { ...p, ...live } : p))
  return { shown, bind, wheel, set: setNow }
}
