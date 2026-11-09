import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import type { AnalysisResult, StepKey, Take } from '../types'
import type { BenchState } from './api'
import { initialBenchState, patchGoal, patchMicProfile, reconcileFxDist, useBench } from './benchStore'
import { selectBestControl, selectSuggestion } from './selectors'
import { DEFAULT_MIC } from '../mics/catalog'
import { analyze } from '../audio/analyze'
import { englishText } from '../settings/english'

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
    st().goTo('privacy')
    expect([st().screen, st().step]).toEqual(['step', 1])
  })

  it('opens site pages without touching the wizard state', () => {
    expect(initialBenchState().screen).toBe('home')
    const takes = [mkTake(1, 's1', 'c2'), mkTake(2, 's1', 'c8')]
    reset({ screen: 'step', step: 2, takes, lastTakeId: 2, A: 1, B: 2, view: 'ab' })
    for (const screen of ['home', 'how', 'community', 'privacy'] as const) {
      st().goTo(screen, 0)
      expect(st()).toMatchObject({ screen, step: 2, lastTakeId: 2, A: 1, B: 2, view: 'ab' })
    }
    st().goTo('step', 2)
    expect([st().screen, st().step]).toEqual(['step', 2])
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
    expect(st().status).toEqual({ msg: { key: 'engine.status.tooShort', params: { sec: 4, min: 5, quiet: 3 } }, error: true })
    expect(englishText(st().status!.msg)).toBe('Too short (4.0 s). Record at least 5 s: 3 s of silence, then the text.')
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

describe('processed take distance', () => {
  // best control: the 2 cm take (the others are boomy)
  const controls = () => [mkTake(1, 's1', 'c2'), mkTake(2, 's1', 'c8', fakeAnalysis({ rel: BOOMY_REL })), mkTake(3, 's1', 'c15', fakeAnalysis({ rel: BOOMY_REL }))]

  it('drops an fxDist that is not the best control distance, unless the person chose it', () => {
    const takes = controls()
    expect(reconcileFxDist({ takes, session: 's1', fxDist: '15 cm' }, false)).toEqual({ fxDist: null })
    expect(reconcileFxDist({ takes, session: 's1', fxDist: '15 cm' }, true)).toEqual({})
    expect(reconcileFxDist({ takes, session: 's1', fxDist: '2 cm' }, false)).toEqual({})
    expect(reconcileFxDist({ takes, session: 's1', fxDist: null }, false)).toEqual({})
    // no best control yet: nothing to compare with
    expect(reconcileFxDist({ takes: [], session: 's1', fxDist: '15 cm' }, false)).toEqual({})
  })

  it('resets fxDist when the best control changes, keeps an explicit choice', () => {
    st().newSession()
    reset({ takes: controls(), fxDist: '2 cm' })
    st().deleteTake(1)
    expect(st().fxDist).toBeNull()
    st().newSession()
    reset({ takes: controls() })
    st().setFxDist('2 cm')
    st().deleteTake(1)
    expect(st().fxDist).toBe('2 cm')
    st().newSession()
    expect(st().fxDist).toBeNull()
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
    expect(st().status?.msg).toEqual({ key: 'engine.status.micDenied', params: { error: 'NotAllowedError: denied' } })
    expect(st().mic.error).toEqual(st().status?.msg)
    expect(englishText(st().status!.msg)).toBe(
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

  it('restores a saved site page and becomes ready only after the saved screen is set', async () => {
    vi.resetModules()
    const mod = await import('./benchStore')
    localStorage.setItem('vcb-ui', JSON.stringify({ screen: 'privacy', step: 1, session: 's7', A: null, B: null, view: 'a', fxDist: null }))
    const seen: string[] = []
    const unsub = mod.useBench.subscribe((s, prev) => {
      if (s.ready && !prev.ready) seen.push(s.screen)
    })
    const p = mod.useBench.getState().bootstrap()
    expect(mod.useBench.getState().screen).toBe('privacy')
    await p
    unsub()
    expect(seen).toEqual(['privacy'])
    expect(mod.useBench.getState()).toMatchObject({ ready: true, screen: 'privacy', step: 1 })
    localStorage.clear()
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

describe('mains setting', () => {
  afterEach(() => localStorage.clear())

  it('defaults to auto, saves a choice and re-analyzes every take with it', async () => {
    expect(initialBenchState().mains).toBe('auto')
    reset({ takes: [mkTake(1, 's1', 'c2'), mkTake(2, 's1', 'c8')] })
    st().setMains(60)
    expect(st().mains).toBe(60)
    expect(JSON.parse(localStorage.getItem('vcb-mains') ?? 'null')).toBe(60)
    await vi.waitFor(() => expect(vi.mocked(analyze)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(analyze).mock.calls.map((c) => c[2])).toEqual([{ mains: 60 }, { mains: 60 }])
    st().setMains(50)
    await vi.waitFor(() => expect(vi.mocked(analyze)).toHaveBeenCalledTimes(4))
    expect(vi.mocked(analyze).mock.calls[3][2]).toEqual({ mains: 50 })
  })

  it('resolves auto from the browser region at analysis time', async () => {
    reset({ takes: [mkTake(1, 's1', 'c2')], mains: 60 })
    const langs = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['pt-BR'])
    st().setMains('auto')
    await vi.waitFor(() => expect(vi.mocked(analyze)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(analyze).mock.calls[0][2]).toEqual({ mains: 60 })
    langs.mockReturnValue(['de-DE'])
    st().setMains(60)
    st().setMains('auto')
    await vi.waitFor(() => expect(vi.mocked(analyze).mock.calls.at(-1)?.[2]).toEqual({ mains: 50 }))
    langs.mockRestore()
  })

  it('is restored on bootstrap', async () => {
    vi.resetModules()
    const mod = await import('./benchStore')
    localStorage.setItem('vcb-mains', '50')
    await mod.useBench.getState().bootstrap()
    expect(mod.useBench.getState().mains).toBe(50)
  })
})

describe('voice goal', () => {
  afterEach(() => localStorage.clear())

  it('starts natural with nothing perceived', () => {
    expect(initialBenchState().goal).toEqual({ style: 'natural', perceived: [] })
  })

  it('patchGoal merges and filters', () => {
    expect(patchGoal({ style: 'warm', perceived: ['nasal'] }, { style: 'clear' })).toEqual({ style: 'clear', perceived: ['nasal'] })
    expect(patchGoal({ style: 'warm', perceived: [] }, { perceived: ['dull', 'dull', 'loud' as never] })).toEqual({ style: 'warm', perceived: ['dull'] })
    expect(patchGoal({ style: 'warm', perceived: [] }, { style: 'toString' as never })).toEqual({ style: 'warm', perceived: [] })
  })

  it('setGoal saves it and changes derived views only: no re-recording, no re-analysis', () => {
    const takes = [mkTake(1, 's1', 'c2', fakeAnalysis({ rel: BOOMY_REL })), mkTake(2, 's1', 'c8'), mkTake(3, 's1', 'fx')]
    reset({ takes, A: 3, B: 2, fxDist: '8 cm', screen: 'results' })
    const before = st()
    const suggestion = selectSuggestion(before)
    st().setGoal({ style: 'warm', perceived: ['nasal'] })
    const after = st()
    expect(after.goal).toEqual({ style: 'warm', perceived: ['nasal'] })
    expect(JSON.parse(localStorage.getItem('vcb-goal') ?? 'null')).toEqual({ style: 'warm', perceived: ['nasal'] })
    expect(after.takes).toBe(before.takes)
    after.takes.forEach((t, i) => expect(t.analysis).toBe(before.takes[i].analysis))
    expect([after.A, after.B, after.fxDist, after.screen, after.session]).toEqual([3, 2, '8 cm', 'results', 's1'])
    expect(vi.mocked(analyze)).not.toHaveBeenCalled()
    expect(fake.startRecording).not.toHaveBeenCalled()
    // derived views recompute: the by-ear nasal tweak shows up in the suggestion
    expect(suggestion?.eq.some((e) => e.byEar)).toBe(false)
    expect(selectSuggestion(after)?.eq.some((e) => e.byEar)).toBe(true)
    st().setGoal({ perceived: [] })
    expect(st().goal).toEqual({ style: 'warm', perceived: [] })
  })

  it('best control follows the goal', () => {
    const takes = [mkTake(1, 's1', 'c2', fakeAnalysis({ rel: [-18, -1, -1, 2, 0, -6, -7, -11, -17] })), mkTake(2, 's1', 'c8')]
    reset({ takes })
    expect(selectBestControl(st())?.dist).toBe('8 cm')
    st().setGoal({ style: 'warm' })
    expect(selectBestControl(st())?.dist).toBe('2 cm')
  })

  it('is restored on bootstrap', async () => {
    vi.resetModules()
    const mod = await import('./benchStore')
    localStorage.setItem('vcb-goal', JSON.stringify({ style: 'bright', perceived: ['harsh', 'x'] }))
    await mod.useBench.getState().bootstrap()
    expect(mod.useBench.getState().goal).toEqual({ style: 'bright', perceived: ['harsh'] })
  })
})
