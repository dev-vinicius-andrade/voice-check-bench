import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import type { AnalysisResult, StepKey, Take } from '../types'
import type { BenchState } from './api'
import { initialBenchState, patchMicProfile, useBench } from './benchStore'
import { DEFAULT_MIC } from '../mics/catalog'

const fake = vi.hoisted(() => {
  const engine = {
    samples: new Float32Array(0),
    sampleRate: 48000,
    recordingTime: 0,
    isSupported: () => true,
    open: vi.fn(async (id?: string) => ({ deviceId: id ?? 'def', label: `Input ${id ?? 'def'} (2- Elgato)` })),
    openWithFallback: vi.fn(async (id?: string) => ({ deviceId: id ?? 'def', label: `Input ${id ?? 'def'}` })),
    listInputs: vi.fn(async () => [
      { deviceId: 'a', label: 'Speakers mic' },
      { deviceId: 'raw1', label: 'Elgato Wave:XLR (Mic In)' },
      { deviceId: 'fx1', label: 'Elgato Virtual Audio (Record Mix)' },
    ]),
    startRecording: vi.fn(),
    stopRecording: vi.fn((): Float32Array => engine.samples),
    level: () => -50,
    play: vi.fn(),
    stopPlayback: vi.fn(),
  }
  return engine
})
vi.mock('./engine', () => ({ getEngine: () => fake }))
vi.mock('../audio/analyze', async () => {
  const { fakeAnalysis: fa } = await import('../audio/testSignals')
  return { analyze: vi.fn(() => fa()) }
})

const BOOMY_REL = [-18, 8, -1, 2, 0, -6, -7, -11, -17]
const mkTake = (id: number, session: string, step: StepKey | null, analysis: AnalysisResult = fakeAnalysis()): Take => ({
  id,
  name: `take ${id}`,
  session,
  step,
  device: 'Mic',
  sampleRate: 48000,
  samples: new Float32Array(16),
  created: new Date(id).toISOString(),
  analysis,
})

const reset = (over: Partial<BenchState> = {}): void =>
  useBench.setState({ ...initialBenchState(), session: 's1', ready: true, ...over })
const st = () => useBench.getState()
const micOn = { status: 'on' as const, deviceId: 'raw1', label: 'Elgato Wave:XLR (Mic In)', error: null }

beforeEach(() => {
  reset()
  fake.recordingTime = 0
  vi.clearAllMocks()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('navigation', () => {
  it('back from step 0 goes to setup, back from step n to n-1', () => {
    reset({ screen: 'step', step: 0 })
    st().back()
    expect(st().screen).toBe('setup')
    reset({ screen: 'step', step: 2 })
    st().back()
    expect([st().screen, st().step]).toEqual(['step', 1])
  })

  it('back and skip from a free take go to results', () => {
    reset({ screen: 'step', step: 'free' })
    st().back()
    expect(st().screen).toBe('results')
    reset({ screen: 'step', step: 'free' })
    st().skip()
    expect(st().screen).toBe('results')
  })

  it('next on the last step shows processed vs best control as a difference', () => {
    const takes = [mkTake(1, 's1', 'c2', fakeAnalysis({ rel: BOOMY_REL })), mkTake(2, 's1', 'c8'), mkTake(3, 's1', 'fx')]
    reset({ screen: 'step', step: 3, takes, lastTakeId: 3 })
    st().next()
    expect(st()).toMatchObject({ screen: 'results', A: 3, B: 2, view: 'diff', lastTakeId: null })
  })

  it('results without a processed take pick the latest valid take as A and the best control as B', () => {
    const takes = [mkTake(1, 's1', 'c2', fakeAnalysis({ rel: BOOMY_REL })), mkTake(2, 's1', 'c8'), mkTake(4, 'free', null, { error: 'x' })]
    reset({ takes })
    st().goTo('results')
    expect(st()).toMatchObject({ A: 2, B: null, view: 'a' })
    reset({ takes: [...takes, mkTake(6, 'free', null)] })
    st().goTo('results')
    expect(st()).toMatchObject({ A: 6, B: 2, view: 'ab' })
  })

  it('next from a free take sets A to the new take', () => {
    reset({ screen: 'step', step: 'free', takes: [mkTake(1, 'free', null), mkTake(2, 'free', null)], lastTakeId: 1, A: 2 })
    st().next()
    expect(st()).toMatchObject({ screen: 'results', A: 1 })
  })

  it('is blocked while recording', () => {
    reset({ screen: 'step', step: 1, recorder: { phase: 'reading', elapsed: 5 } })
    st().next()
    st().back()
    st().goTo('results')
    expect([st().screen, st().step]).toEqual(['step', 1])
  })
})

describe('take selection', () => {
  it('setA swaps with B when picking the current B', () => {
    reset({ A: 1, B: 2 })
    st().setA(2)
    expect([st().A, st().B]).toEqual([2, 1])
    st().setA(3)
    expect([st().A, st().B]).toEqual([3, 1])
  })

  it('toggleB toggles and moves the view between a and ab', () => {
    reset({ A: 1, view: 'a' })
    st().toggleB(2)
    expect([st().B, st().view]).toEqual([2, 'ab'])
    st().setView('diff')
    st().toggleB(3)
    expect([st().B, st().view]).toEqual([3, 'diff'])
    st().toggleB(3)
    expect([st().B, st().view]).toEqual([null, 'a'])
    st().toggleB(1)
    expect([st().B, st().view]).toEqual([null, 'a'])
  })

  it('deleteTake clears A/B pointing at it', () => {
    reset({ screen: 'step', takes: [mkTake(1, 's1', 'c2'), mkTake(2, 's1', 'c8')], A: 1, B: 2 })
    st().deleteTake(1)
    expect([st().A, st().B, st().takes.length]).toEqual([null, 2, 1])
    st().deleteTake(2)
    expect([st().A, st().B, st().takes.length]).toEqual([null, null, 0])
  })

  it('deleteTake on results falls back to the latest valid take as A', () => {
    reset({ screen: 'results', takes: [mkTake(1, 's1', 'c2'), mkTake(2, 's1', 'c8'), mkTake(3, 's1', 'c15')], A: 3, B: 2 })
    st().deleteTake(3)
    expect([st().A, st().B]).toEqual([2, null])
  })

  it('deleteAll starts a new session and resets selection', () => {
    reset({ takes: [mkTake(1, 's1', 'c2')], A: 1, B: 1, fxDist: '2 cm' })
    st().deleteAll()
    expect(st()).toMatchObject({ takes: [], A: null, B: null, fxDist: null })
    expect(st().session).not.toBe('s1')
  })
})

describe('recording', () => {
  it('rejects a take shorter than QUIET_SEC + 2 s', async () => {
    reset({ screen: 'step', step: 'free', mic: micOn })
    await st().startRecording()
    expect(st().recorder.phase).toBe('silence')
    fake.samples = new Float32Array(48000 * 4)
    st().stopRecording()
    expect(st().recorder.phase).toBe('idle')
    expect(st().status).toEqual({ message: 'Too short (4.0 s). Record at least 5 s: 3 s of silence, then the text.', error: true })
    expect(st().takes).toEqual([])
  })

  it('requires the microphone', async () => {
    reset({ screen: 'step', step: 0 })
    await st().startRecording()
    expect(st().recorder.phase).toBe('idle')
    expect(st().status?.error).toBe(true)
  })

  it('switches to the step device, auto-stops at MAX_SEC and saves the processed take', async () => {
    vi.useFakeTimers()
    const takes = [mkTake(1, 's1', 'c2', fakeAnalysis({ rel: BOOMY_REL })), mkTake(2, 's1', 'c15')]
    reset({ screen: 'step', step: 3, takes, mic: micOn, deviceChoice: { raw: 'raw1', fx: 'fx1' } })
    await st().startRecording()
    expect(fake.open).toHaveBeenCalledWith('fx1')
    fake.recordingTime = 4
    vi.advanceTimersByTime(100)
    expect(st().recorder).toEqual({ phase: 'reading', elapsed: 4 })
    fake.samples = new Float32Array(48000 * 10)
    fake.recordingTime = 30
    vi.advanceTimersByTime(100)
    expect(st().recorder.phase).toBe('analyzing')
    vi.advanceTimersByTime(30)
    const t = st().takes.at(-1)
    expect(t).toMatchObject({ session: 's1', step: 'fx', name: 'Processed · 15 cm · Record Mix', device: 'Input fx1 (2- Elgato)' })
    expect(st()).toMatchObject({ fxDist: '15 cm', recorder: { phase: 'idle', elapsed: 0 } })
  })

  it('names a free take after the input and clears the name field', async () => {
    vi.useFakeTimers()
    const mic = { model: 'My mic', kind: 'condenser', pattern: 'omni', address: 'side' } as const
    reset({ screen: 'step', step: 'free', mic: micOn, micProfile: mic })
    await st().startRecording()
    fake.samples = new Float32Array(48000 * 6)
    st().stopRecording()
    vi.advanceTimersByTime(30)
    expect(st().takes[0]).toMatchObject({ session: 'free', step: null, name: 'Free take · Elgato Wave:XLR', mic })
    expect(st().takes[0].mic).not.toBe(st().micProfile)
    expect(st().lastTakeId).toBe(st().takes[0].id)
    st().setFreeTakeName('  Mine ')
    await st().startRecording()
    st().stopRecording()
    vi.advanceTimersByTime(30)
    expect(st().takes[1].name).toBe('Mine')
    expect(st().freeTakeName).toBe('')
  })
})

describe('enableMic', () => {
  it('auto-picks inputs by name and keeps a saved choice that still exists', async () => {
    reset({ deviceChoice: { raw: null, fx: 'a' } })
    await st().enableMic()
    expect(st().deviceChoice).toEqual({ raw: 'raw1', fx: 'a' })
    expect(st().mic.status).toBe('on')
  })

  it('reports errors', async () => {
    fake.openWithFallback.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    await st().enableMic()
    expect(st().mic.status).toBe('error')
    expect(st().status?.message).toBe(
      'Could not open the microphone (NotAllowedError: denied). Allow microphone access in the address bar, then reload.',
    )
  })
})

describe('bootstrap', () => {
  it('restores UI prefs once and marks the store ready', async () => {
    useBench.setState({ ...initialBenchState() })
    localStorage.setItem('vcb-ui', JSON.stringify({ screen: 'step', step: 9, session: 's42', A: null, B: null, view: 'a', fxDist: '2 cm' }))
    localStorage.setItem('vcb-mic', JSON.stringify({ model: 'Blue Yeti', kind: 'condenser', pattern: 'omni', address: 'side' }))
    const p1 = st().bootstrap()
    const p2 = st().bootstrap()
    expect(p2).toBe(p1)
    await p1
    expect(st()).toMatchObject({ ready: true, screen: 'step', step: 0, session: 's42', fxDist: '2 cm' })
    expect(st().micProfile).toEqual({ model: 'Blue Yeti', kind: 'condenser', pattern: 'omni', address: 'side' })
    st().setView('ab')
    expect(JSON.parse(localStorage.getItem('vcb-ui') ?? '{}')).toMatchObject({ view: 'ab', session: 's42' })
  })
})

describe('mic profile', () => {
  afterEach(() => localStorage.clear())

  it('starts unknown', () => {
    expect(initialBenchState().micProfile).toEqual(DEFAULT_MIC)
  })

  it('fills traits from a known model unless the patch sets them', () => {
    expect(patchMicProfile(DEFAULT_MIC, { model: 'shure sm7b' })).toEqual({
      model: 'shure sm7b',
      kind: 'dynamic',
      pattern: 'cardioid',
      address: 'end',
    })
    expect(patchMicProfile(DEFAULT_MIC, { model: 'Blue Yeti', pattern: 'omni' })).toMatchObject({ pattern: 'omni', address: 'side' })
    const custom = patchMicProfile({ ...DEFAULT_MIC, kind: 'condenser' }, { model: 'Homemade', address: undefined })
    expect(custom).toEqual({ model: 'Homemade', kind: 'condenser', pattern: 'unknown', address: 'unknown' })
  })

  it('setMicProfile updates the state and saves it', () => {
    st().setMicProfile({ model: 'Rode NT-USB' })
    st().setMicProfile({ kind: 'dynamic' })
    const want = { model: 'Rode NT-USB', kind: 'dynamic', pattern: 'cardioid', address: 'side' }
    expect(st().micProfile).toEqual(want)
    expect(JSON.parse(localStorage.getItem('vcb-mic') ?? '{}')).toEqual(want)
  })
})
