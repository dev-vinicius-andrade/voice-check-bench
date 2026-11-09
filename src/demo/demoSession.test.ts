import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import { deviations } from '../audio/reference'
import { initialBenchState, useBench } from '../store/benchStore'
import { isAnalysisError, type Analysis, type Take } from '../types'
import { exitDemo, loadDemoSession, useDemo } from './demoSession'
import { DEMO_MIC, DEMO_SESSION, buildDemoTakes } from './demoTakes'

const db = vi.hoisted(() => ({
  available: true,
  all: vi.fn(async () => []),
  put: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  clear: vi.fn(async () => undefined),
}))
vi.mock('../storage/takesDb', () => ({ openTakesDb: async () => db }))

const engine = vi.hoisted(() => ({
  sampleRate: 48000,
  recordingTime: 0,
  isSupported: () => true,
  open: vi.fn(async (id: string) => ({ deviceId: id, label: 'Mic' })),
  startRecording: vi.fn(),
  stopRecording: vi.fn(() => new Float32Array(48000 * 6)),
}))
vi.mock('../store/engine', () => ({ getEngine: () => engine }))

const st = () => useBench.getState()
const real = (id: number): Take => ({
  id, name: 'mine', session: 's1', step: 'c8', device: 'Mic', sampleRate: 48000, samples: new Float32Array(4), created: '', analysis: fakeAnalysis(),
})
const ok = (t: Take): Analysis => {
  if (isAnalysisError(t.analysis)) throw new Error(t.analysis.error)
  return t.analysis
}
const flush = () => new Promise((r) => setTimeout(r, 0))

// built once: analyzing four synthetic takes takes a moment
const demo = buildDemoTakes(1_000_000)

beforeEach(() => {
  useBench.setState({ ...initialBenchState(), session: 's1', ready: true, takes: [real(1)], A: 1, screen: 'home' })
  useDemo.setState({ active: false, dismissed: false })
  vi.clearAllMocks()
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())

describe('demo takes', () => {
  it('are four analyzed guided takes in the demo session with the example mic', () => {
    expect(demo.map((t) => t.step)).toEqual(['c2', 'c8', 'c15', 'fx'])
    expect(demo.map((t) => t.name)).toEqual(['Control · 2 cm · raw', 'Control · 8 cm · raw', 'Control · 15 cm · raw', 'Processed · 8 cm · Record Mix'])
    for (const t of demo) expect(t).toMatchObject({ session: DEMO_SESSION, mic: DEMO_MIC })
    expect(new Set(demo.map((t) => t.id)).size).toBe(4)
    demo.forEach(ok)
  })

  it('sound boomy at 2 cm, balanced at 8 cm, thin and noisy at 15 cm, cleaner processed, with a steady fan', () => {
    const [c2, c8, c15, fx] = demo.map(ok)
    expect(deviations(c2.rel)[1]).toBeGreaterThan(4)
    expect(Math.abs(deviations(c8.rel)[1])).toBeLessThan(1.5)
    expect(deviations(c15.rel)[1]).toBeLessThan(-3)
    expect(c15.snr).toBeLessThan(c8.snr)
    expect(c8.noiseKind).toBe('tonal')
    expect(c8.tones.map((t) => t.hz).some((hz) => Math.abs(hz - 780) < 10)).toBe(true)
    expect(c8.tones.map((t) => t.hz).some((hz) => Math.abs(hz - 1560) < 15)).toBe(true)
    expect(fx.noise).toBeLessThan(c8.noise - 10)
  })
})

describe('loadDemoSession', () => {
  it('adds the demo takes next to the real ones, opens results with A/B and never saves them', async () => {
    loadDemoSession()
    await flush()
    const ids = st().takes.filter((t) => t.session === DEMO_SESSION).map((t) => t.id)
    expect(ids).toHaveLength(4)
    expect(st().takes.some((t) => t.id === 1)).toBe(true)
    expect(st().session).toBe('s1')
    expect(st()).toMatchObject({ screen: 'results', A: ids[3], B: ids[1], view: 'diff' })
    expect(useDemo.getState().active).toBe(true)
    expect(db.put).not.toHaveBeenCalled()
    const saved = JSON.parse(localStorage.getItem('vcb-ui') ?? '{}')
    expect(saved).toMatchObject({ screen: 'results', A: null, B: null, view: 'a', session: 's1' })
  })

  it('waits until the store has loaded the real takes', () => {
    useBench.setState({ ready: false, takes: [] })
    loadDemoSession()
    expect(st().takes).toHaveLength(0)
    useBench.setState({ takes: [real(1)], ready: true })
    expect(st().takes).toHaveLength(5)
    expect(st().screen).toBe('results')
  })
})

describe('exitDemo', () => {
  it('removes the demo takes from memory only and goes to setup', async () => {
    loadDemoSession()
    exitDemo()
    await flush()
    expect(st().takes.map((t) => t.id)).toEqual([1])
    expect(st()).toMatchObject({ screen: 'setup', A: null, B: null })
    expect(useDemo.getState().active).toBe(false)
    expect(db.remove).not.toHaveBeenCalled()
    expect(db.clear).not.toHaveBeenCalled()
  })

  it('deleting one demo take does not touch the database', async () => {
    loadDemoSession()
    const c2 = st().takes.find((t) => t.session === DEMO_SESSION && t.step === 'c2')
    expect(c2).toBeDefined()
    st().deleteTake(c2?.id ?? -1)
    expect(st().takes.some((t) => t.id === c2?.id)).toBe(false)
    await flush()
    expect(db.remove).not.toHaveBeenCalled()
  })
})

describe('save path', () => {
  const record = async (session: string): Promise<void> => {
    vi.useFakeTimers()
    useBench.setState({ screen: 'step', step: 0, session, mic: { status: 'on', deviceId: 'raw1', label: 'Mic', error: null }, deviceChoice: { raw: 'raw1', fx: null } })
    await st().startRecording()
    st().stopRecording()
    vi.advanceTimersByTime(30)
    vi.useRealTimers()
    await flush()
  }

  it('saves takes of a real session', async () => {
    await record('s1')
    expect(db.put).toHaveBeenCalledTimes(1)
  })

  it('never saves takes of the demo session', async () => {
    await record(DEMO_SESSION)
    expect(st().takes.at(-1)?.session).toBe(DEMO_SESSION)
    expect(db.put).not.toHaveBeenCalled()
  })
})
