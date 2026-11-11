import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { held, tone } from '../../../desktop/advice/testFixtures'
import type { HeldMetrics } from '../../../live/hold'
import { useToneTrend } from './useToneTrend'

interface Props {
  h: HeldMetrics | null
  nb: number | undefined
  style: string
}

/** Renders one held window per second (presence +3 dB) and returns the hook result. */
function run(n: number, style = 'natural') {
  const r = renderHook(({ h, nb, style: s }: Props) => useToneTrend(h, nb, s), { initialProps: { h: null, nb: undefined, style } as Props })
  for (let i = 0; i < n; i++) r.rerender({ h: held({ heardAtMs: 1000 + i * 1000, tone: tone({ 6: 3 }) }), nb: undefined, style })
  return r
}

describe('useToneTrend', () => {
  it('adds each new window once and gives the stable tone after enough of them', () => {
    const r = run(12)
    expect(r.result.current.tone[6]).toBe(3)
    expect(r.result.current.evidenceSec).toBe(15)
    // the same held object again (a re-render) adds nothing
    const last = held({ heardAtMs: 12_000, tone: tone({ 6: 3 }) })
    r.rerender({ h: last, nb: undefined, style: 'natural' })
    r.rerender({ h: last, nb: undefined, style: 'natural' })
    expect(r.result.current.evidenceSec).toBe(15)
  })

  it('starts over after a change (new notBeforeMs), a new style and reset()', () => {
    const r = run(12)
    r.rerender({ h: held({ heardAtMs: 20_000, tone: tone({ 6: 3 }) }), nb: 20_000, style: 'natural' })
    expect(r.result.current.tone[6]).toBeNaN()
    expect(r.result.current.evidenceSec).toBe(4)
    const s = run(12)
    s.rerender({ h: held({ heardAtMs: 13_000, tone: tone({ 6: 3 }) }), nb: undefined, style: 'warm' })
    expect(s.result.current.evidenceSec).toBe(4)
    const t = run(12)
    act(() => t.result.current.reset())
    expect(t.result.current).toMatchObject({ tone: [], evidenceSec: 0 })
  })
})
