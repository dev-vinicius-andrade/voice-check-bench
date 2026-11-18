import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { useEffect } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { slotAt } from '../../../../desktop/advice/chain'
import type { DesktopBridge } from '../../../../desktop/bridge'
import { changeLineMsg } from '../../../../desktop/changeMsg'
import { eqStateValues } from '../../../../desktop/slots'
import { EQ_LIMITS, type NotchPlan, type SpectrumTone } from '../../../../desktop/spectrum'
import { audioStatus, snapshot } from '../../../../desktop/testChain'
import { noiseFrames } from '../../../../desktop/testFrames'
import type { AudioFrame } from '../../../../desktop/types'
import i18n from '../../../../i18n'
import en from '../../../../i18n/locales/en/desktop.json'
import pt from '../../../../i18n/locales/pt-BR/desktop.json'
import { theme } from '../../../../theme'
import { useChainState, type BatchOp, type ChainState } from '../useChainState'
import { gainOfY, hzOfX, plotBox, snapGain, stepFreq, stepWidth, xOfHz, yOfGain } from './plotScale'
import { SpectrumCard } from './SpectrumCard'

// the analysis is another module's job: a fake analyzer whose tones the test sets, a notch plan the test picks
const h = vi.hoisted(() => ({ tones: [] as SpectrumTone[], plan: null as NotchPlan | null, resets: 0 }))
vi.mock('../../../../desktop/spectrum', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../desktop/spectrum')>()
  const { eqBands } = await import('../../../../desktop/advice/chain')
  const n = real.SPECTRUM_POINTS
  return {
    ...real,
    createSpectrumAnalyzer: () => ({
      push: () => undefined,
      read: () => ({ freqsHz: new Float32Array(n), rawDb: new Float32Array(n).fill(-80), processedDb: new Float32Array(n).fill(-60), tones: h.tones }),
      reset: () => void h.resets++,
    }),
    eqPointsOf: (slot: Parameters<typeof eqBands>[0]) => eqBands(slot),
    eqCurveDb: (_p: unknown, f: Float32Array) => new Float32Array(f.length),
    notchPlan: () => h.plan,
  }
})

const T = en.desktop.tune.spectrum
const EQ = 2
const box = plotBox(800, 260)
const TONE: SpectrumTone = { freqHz: 923.4, levelDb: -48, overDb: 30.2, inRaw: true, inProcessed: true }
const PLAN: NotchPlan = { n: 2, freqHz: 923, gainDb: -18, bwOct: 0.1, enable: false }

const listeners = new Set<(f: AudioFrame) => void>()
const onFrame = (l: (f: AudioFrame) => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
const push = (frames: AudioFrame[]) => act(() => frames.forEach((f) => listeners.forEach((l) => l(f))))

const calls: [string, number, string, number][] = []
const batches: BatchOp[][] = []
let current: ChainState
const status = audioStatus()
const bridge = {
  audioLoadState: vi.fn(async (slot: number) => status.slots[slot]),
  audioSetParam: vi.fn(async (slot: number) => status.slots[slot]),
  audioSetBypass: vi.fn(async (slot: number) => status.slots[slot]),
} as unknown as DesktopBridge

/** The card on a real live chain (the test chain: ReaEQ in slot 2 with Low Shelf 150 Hz, Band 3500 Hz −2 dB, High Shelf 10 kHz). */
function Harness({ running }: { running: boolean }) {
  const chain = useChainState(bridge, () => undefined, () => 0)
  const { load } = chain
  useEffect(() => load(audioStatus(), snapshot()), [load])
  useEffect(() => {
    current = chain
  })
  const spied: ChainState = {
    ...chain,
    preview: (s, k, v) => (calls.push(['preview', s, k, v]), chain.preview(s, k, v)),
    commit: (s, k, v) => (calls.push(['commit', s, k, v]), chain.commit(s, k, v)),
    applyBatch: (b) => (batches.push([...b]), chain.applyBatch(b)),
  }
  return <SpectrumCard engine={{ state: running ? 'running' : 'idle', onFrame }} chain={spied} />
}

const view = (running = true) => {
  const r = render(<ThemeProvider theme={theme}><Harness running={running} /></ThemeProvider>)
  return { ...r, rerun: (on: boolean) => r.rerender(<ThemeProvider theme={theme}><Harness running={on} /></ThemeProvider>) }
}
const band = (n: number) => screen.getByTestId(`spectrum-band-${n}`)
const eqValue = (key: string) => slotAt(current.model!.undo.chain, EQ)!.values[key]

beforeAll(async () => {
  await i18n.changeLanguage('en')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
beforeEach(() => {
  h.tones = []
  h.plan = PLAN
  calls.length = 0
  batches.length = 0
})
afterEach(cleanup)

describe('live spectrum card: states', () => {
  it('only a hint while the engine is stopped; resets the analyzer when it starts and stops', async () => {
    const r = view(false)
    expect(screen.getByTestId('spectrum-idle').textContent).toBe(T.idle)
    expect(screen.queryByTestId('spectrum-plot')).toBeNull()
    const before = h.resets
    r.rerun(true)
    await screen.findByTestId('spectrum-band-1')
    expect(h.resets).toBe(before + 1)
    r.rerun(false)
    expect(screen.getByTestId('spectrum-idle')).toBeTruthy()
    expect(h.resets).toBe(before + 2)
  })

  it('listens first, then lists the steady tones, or says there are none', async () => {
    view()
    await screen.findByTestId('spectrum-band-1')
    expect(screen.getByTestId('spectrum-tones-empty').textContent).toBe(T.tones.listening)
    push(noiseFrames(5, 0))
    expect(screen.getByTestId('spectrum-tones-empty').textContent).toBe(T.tones.none)
    h.tones = [TONE]
    push(noiseFrames(1, 50))
    expect(screen.getByTestId('spectrum-tone').textContent).toContain('Steady tone at 923 Hz · 30 dB over its surroundings')
    expect(screen.getAllByTestId('spectrum-tone-marker')).toHaveLength(1)
    h.tones = []
    push(noiseFrames(1, 60))
    expect(screen.queryByTestId('spectrum-tone')).toBeNull()
  })

  it('without a ReaEQ switched on: spectrum and tones only, with a hint', async () => {
    view()
    await screen.findByTestId('spectrum-band-1')
    act(() => current.setOn(EQ, false))
    expect(screen.getByTestId('spectrum-no-eq').textContent).toBe(T.noEq)
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByTestId('spectrum-eq-curve')).toBeNull()
    h.tones = [TONE]
    push(noiseFrames(1, 0))
    expect(screen.getByTestId('spectrum-tone')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Cut/ })).toBeNull()
  })
})

describe('live spectrum card: band handles', () => {
  it('shows one labelled slider per band', async () => {
    view()
    expect((await screen.findByTestId('spectrum-band-2')).getAttribute('aria-label')).toBe('Band 2, 3500 Hz, -2.0 dB')
    expect(screen.getAllByRole('slider')).toHaveLength(3)
  })

  it('dragging previews frequency and gain, then commits each changed key, snapped and clamped', async () => {
    view()
    const b = await screen.findByTestId('spectrum-band-2')
    const at = { x: xOfHz(box, eqValue('band2.freqHz')), y: yOfGain(box, eqValue('band2.gainDb')) }
    fireEvent.pointerDown(b, { clientX: at.x, clientY: at.y, pointerId: 1 })
    const to = { x: xOfHz(box, 1000), y: yOfGain(box, -12.3) }
    fireEvent.pointerMove(b, { clientX: to.x, clientY: to.y, pointerId: 1 })
    expect(calls).toEqual([
      ['preview', EQ, 'band2.freqHz', expect.closeTo(1000, 6)],
      ['preview', EQ, 'band2.gainDb', -12.5],
    ])
    fireEvent.pointerMove(b, { clientX: 5000, clientY: -500, pointerId: 1 })
    expect(calls.slice(2)).toEqual([
      ['preview', EQ, 'band2.freqHz', 20000],
      ['preview', EQ, 'band2.gainDb', EQ_LIMITS.gainDb[1]],
    ])
    fireEvent.pointerMove(b, { clientX: to.x, clientY: to.y, pointerId: 1 })
    fireEvent.pointerUp(b, { clientX: to.x, clientY: to.y, pointerId: 1 })
    expect(calls.filter((c) => c[0] === 'commit')).toEqual([
      ['commit', EQ, 'band2.freqHz', hzOfX(box, to.x)],
      ['commit', EQ, 'band2.gainDb', snapGain(gainOfY(box, to.y))],
    ])
    // both values land in the chain, and the last engine state carries both
    expect(eqValue('band2.freqHz')).toBeCloseTo(1000, 6)
    expect(eqValue('band2.gainDb')).toBe(-12.5)
    await waitFor(() => expect(bridge.audioLoadState).toHaveBeenCalled())
    const state = vi.mocked(bridge.audioLoadState).mock.calls.at(-1)![1]
    expect(eqStateValues(state)['band2.freqHz']).toBeCloseTo(1000, 0)
    expect(eqStateValues(state)['band2.gainDb']).toBeCloseTo(-12.5, 1)
  })

  it('keys move frequency, gain and width and commit each press; Delete and double-click set the gain to 0', async () => {
    view()
    const b = await screen.findByTestId('spectrum-band-2')
    const f0 = eqValue('band2.freqHz')
    const w0 = eqValue('band2.bwOct')
    fireEvent.keyDown(b, { key: 'ArrowRight' })
    expect(calls.at(-1)).toEqual(['commit', EQ, 'band2.freqHz', stepFreq(f0, 1)])
    fireEvent.keyDown(b, { key: 'ArrowLeft' })
    expect(calls.at(-1)?.[3]).toBeCloseTo(f0, 6)
    fireEvent.keyDown(b, { key: 'ArrowUp' })
    expect(calls.at(-1)).toEqual(['commit', EQ, 'band2.gainDb', -1.5])
    fireEvent.keyDown(b, { key: 'ArrowDown' })
    fireEvent.keyDown(b, { key: 'ArrowDown' })
    expect(eqValue('band2.gainDb')).toBe(-2.5)
    fireEvent.keyDown(b, { key: ']' })
    expect(calls.at(-1)).toEqual(['commit', EQ, 'band2.bwOct', stepWidth(w0, 1)])
    fireEvent.keyDown(b, { key: '[' })
    expect(calls.at(-1)?.[2]).toBe('band2.bwOct')
    fireEvent.keyDown(b, { key: 'Delete' })
    expect(eqValue('band2.gainDb')).toBe(0)
    fireEvent.keyDown(band(3), { key: 'ArrowUp' })
    fireEvent.doubleClick(band(3))
    expect(calls.at(-1)).toEqual(['commit', EQ, 'band3.gainDb', 0])
    expect(eqValue('band3.gainDb')).toBe(0)
  })

  it('the wheel changes the width, committed once it rests', async () => {
    view()
    const b = await screen.findByTestId('spectrum-band-2')
    const w0 = eqValue('band2.bwOct')
    fireEvent.wheel(b, { deltaY: -100 })
    fireEvent.wheel(b, { deltaY: -100 })
    expect(calls).toEqual([
      ['preview', EQ, 'band2.bwOct', stepWidth(w0, -1)],
      ['preview', EQ, 'band2.bwOct', stepWidth(stepWidth(w0, -1), -1)],
    ])
    await waitFor(() => expect(calls.at(-1)).toEqual(['commit', EQ, 'band2.bwOct', stepWidth(stepWidth(w0, -1), -1)]))
  })

  it('the selected band has fields that commit on Enter and blur, and an On switch', async () => {
    view()
    fireEvent.focus(await screen.findByTestId('spectrum-band-2'))
    const fields = screen.getByTestId('spectrum-band-fields')
    expect(fields.textContent).toContain('Band 2 · Band')
    const freq = within(fields).getByTestId('spectrum-field-freqHz') as HTMLInputElement
    expect(freq.value).toBe('3500')
    fireEvent.change(freq, { target: { value: '1000' } })
    fireEvent.keyDown(freq, { key: 'Enter' })
    expect(calls.at(-1)).toEqual(['commit', EQ, 'band2.freqHz', 1000])
    const gain = within(screen.getByTestId('spectrum-band-fields')).getByTestId('spectrum-field-gainDb') as HTMLInputElement
    fireEvent.change(gain, { target: { value: '-99' } })
    fireEvent.blur(gain)
    expect(calls.at(-1)).toEqual(['commit', EQ, 'band2.gainDb', EQ_LIMITS.gainDb[0]])
    fireEvent.click(within(screen.getByTestId('spectrum-band-fields')).getByRole('switch'))
    expect(calls.at(-1)).toEqual(['commit', EQ, 'band2.on', 0])
    expect(band(2).getAttribute('aria-label')).toBe(`Band 2, 1000 Hz, ${EQ_LIMITS.gainDb[0]}.0 dB`)
  })
})

describe('live spectrum card: Cut', () => {
  it('Cut applies the plan as one change and selects the band; Undo puts the band back', async () => {
    view()
    await screen.findByTestId('spectrum-band-2')
    const before = ['freqHz', 'gainDb', 'bwOct'].map((k) => eqValue(`band2.${k}`))
    h.tones = [TONE]
    push(noiseFrames(1, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Cut the steady tone at 923 Hz' }))
    expect(batches).toHaveLength(1)
    expect(batches[0].map((b) => b.op === 'apply' && b.advice.kind === 'value' && [b.advice.key, b.advice.to])).toEqual([
      ['band2.freqHz', 923],
      ['band2.bwOct', 0.1],
      ['band2.gainDb', -18],
    ])
    expect([eqValue('band2.freqHz'), eqValue('band2.bwOct'), eqValue('band2.gainDb')]).toEqual([923, 0.1, -18])
    expect(current.applied).toHaveLength(3)
    const row = screen.getByTestId('spectrum-tone')
    expect(row.textContent).toContain('Cut with band 2')
    expect(screen.getByTestId('spectrum-band-fields').textContent).toContain('Band 2')
    fireEvent.click(within(row).getByRole('button', { name: 'Undo the cut at 923 Hz' }))
    expect(batches).toHaveLength(2)
    expect(['freqHz', 'gainDb', 'bwOct'].map((k) => eqValue(`band2.${k}`))).toEqual(before)
    expect(current.applied).toHaveLength(0)
    expect(within(screen.getByTestId('spectrum-tone')).getByRole('button', { name: 'Cut the steady tone at 923 Hz' })).toBeTruthy()
  })

  it('a cut on a switched-off band also switches it on; the cut row stays while the tone is gone', async () => {
    h.plan = { ...PLAN, enable: true }
    view()
    await screen.findByTestId('spectrum-band-2')
    act(() => current.commit(EQ, 'band2.on', 0))
    h.tones = [TONE]
    push(noiseFrames(1, 0))
    fireEvent.click(screen.getByRole('button', { name: /Cut the steady tone/ }))
    expect(batches[0].map((b) => b.op === 'apply' && b.advice.kind === 'value' && b.advice.key)).toEqual(['band2.freqHz', 'band2.bwOct', 'band2.gainDb', 'band2.on'])
    expect(eqValue('band2.on')).toBe(1)
    h.tones = []
    push(noiseFrames(1, 10))
    expect(screen.getByTestId('spectrum-tone').textContent).toContain('Cut with band 2')
  })

  it('no free band: an info line instead of the button', async () => {
    h.plan = null
    view()
    await screen.findByTestId('spectrum-band-2')
    h.tones = [TONE]
    push(noiseFrames(1, 0))
    expect(screen.getByTestId('spectrum-no-band').textContent).toBe(T.tones.noBand)
    expect(screen.queryByRole('button', { name: /Cut/ })).toBeNull()
  })
})

describe('live spectrum: text', () => {
  const keys = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : keys(v as object, `${p}${k}.`)))

  it('every en string has its pt-BR twin, with the agreed wording', () => {
    expect(keys(pt.desktop.tune.spectrum)).toEqual(keys(en.desktop.tune.spectrum))
    const p = pt.desktop.tune.spectrum
    expect([p.title, p.legend.raw, p.legend.processed, p.legend.eq, p.tones.tone, p.tones.cut, p.tones.undo]).toEqual([
      'Espectro ao vivo', 'Microfone puro', 'Como você ouve', 'Curva do EQ', 'Tom constante em {{hz}}', 'Cortar', 'Desfazer',
    ])
    expect(p.fields.width).toContain('Largura')
  })

  it('width and band switch changes have their own change line', () => {
    const eq = slotAt(current.model!.undo.chain, EQ)!
    const c = { id: 'x', reason: 'undo' as const, titleMsg: { key: 'k' }, kind: 'value' as const, slot: EQ, from: 1.4, to: 0.1 }
    expect(changeLineMsg(eq, { ...c, key: 'band2.bwOct' })).toEqual({ key: 'desktop.advice.change.oct', params: { plugin: 'ReaEQ', n: 2, from: 1.4, to: 0.1 } })
    expect(changeLineMsg(eq, { ...c, key: 'band2.on', from: 1, to: 0 }).key).toBe('desktop.advice.change.bandOff')
    expect(en.desktop.advice.change.oct).toContain('oct')
  })
})
