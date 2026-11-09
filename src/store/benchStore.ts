// zustand store implementing src/store/api.ts with the prototype's rules (docs/prototype/voice-check.html).
import { create } from 'zustand'
import { analyze } from '../audio/analyze'
import { MAX_SEC, QUIET_SEC } from '../audio/reference'
import { DEV_MATCH, STEPS, fillDistance } from '../session/steps'
import { bestControl, sessionSlots } from '../session/bestControl'
import { loadDeviceChoice, loadUiPrefs, saveDeviceChoice, saveUiPrefs, type UiPrefs } from '../storage/prefs'
import { openTakesDb, type TakesDb } from '../storage/takesDb'
import { isAnalysisError, type DeviceChoice, type DeviceKind, type Screen, type StepRef, type Take } from '../types'
import type { BenchState, BenchStore } from './api'
import { getEngine } from './engine'
import { selectFxDist } from './selectors'

const KINDS: readonly DeviceKind[] = ['raw', 'fx']
const MIN_SEC = QUIET_SEC + 2
const TICK_MS = 100

export function initialBenchState(): BenchState {
  return {
    ready: false,
    storageAvailable: true,
    takes: [],
    screen: 'setup',
    step: 0,
    session: 's' + Date.now(),
    A: null,
    B: null,
    view: 'a',
    fxDist: null,
    devices: [],
    deviceChoice: { raw: null, fx: null },
    mic: { status: 'off', deviceId: null, label: '', error: null },
    recorder: { phase: 'idle', elapsed: 0 },
    lastTakeId: null,
    freeTakeName: '',
    status: null,
  }
}

// ---------- module state (not rendered) ----------
let dbPromise: Promise<TakesDb> | null = null
const getDb = (): Promise<TakesDb> => (dbPromise ??= openTakesDb())
const dbDo = (fn: (db: TakesDb) => Promise<void>): void => {
  void getDb()
    .then(fn)
    .catch(() => undefined)
}
let booting: Promise<void> | null = null
let recTimer: ReturnType<typeof setInterval> | null = null
const stopTimer = (): void => {
  if (recTimer !== null) clearInterval(recTimer)
  recTimer = null
}

const errName = (e: unknown): string => (e instanceof Error ? e.name : 'Error')
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const yieldToLoop = (): Promise<void> => new Promise((res) => setTimeout(res, 0))
const guidedKind = (s: BenchState): DeviceKind | null =>
  s.screen === 'step' && s.step !== 'free' ? (STEPS[s.step]?.dev ?? null) : null
const latestValid = (takes: readonly Take[]): Take | null =>
  [...takes].reverse().find((t) => !isAnalysisError(t.analysis)) ?? null

/** Keep the saved id if it still exists, else auto-pick by name, else the first input. */
function pickChoices(saved: DeviceChoice, devices: { deviceId: string; label: string }[]): DeviceChoice {
  const out = { ...saved }
  for (const k of KINDS) {
    const id = out[k]
    if (!id || !devices.some((d) => d.deviceId === id))
      out[k] = devices.find((d) => DEV_MATCH[k](d.label))?.deviceId ?? devices[0]?.deviceId ?? null
  }
  return out
}

/** Prototype prepareResults(): processed + best control → A/B diff; else keep A if valid, else latest. */
function prepareResults(s: BenchState): Partial<BenchState> {
  const slots = sessionSlots(s.takes, s.session)
  const best = bestControl(slots)
  const fx = slots[3]
  if (fx && !isAnalysisError(fx.analysis) && best) return { A: fx.id, B: best.take.id, view: 'diff' }
  if (s.takes.some((t) => t.id === s.A)) return {}
  const A = latestValid(s.takes)?.id ?? null
  if (best && best.take.id !== A) return { A, B: best.take.id, view: 'ab' }
  return { A }
}

export const useBench = create<BenchStore>()((set, get) => {
  const setMicOn = (dev: { deviceId: string; label: string }): void =>
    set({ mic: { status: 'on', deviceId: dev.deviceId, label: dev.label, error: null } })

  const labelOf = (id: string): string => get().devices.find((d) => d.deviceId === id)?.label ?? ''

  /** Opens an input without touching the saved choices (prototype openSafe). */
  const openSafe = async (deviceId: string): Promise<void> => {
    try {
      setMicOn(await getEngine().open(deviceId))
      set({ status: null })
    } catch (e) {
      get().setStatus(`Could not open this input (${errName(e)}).`, true)
    }
  }

  /** Prototype useDeviceFor(): make sure the input chosen for `kind` is open. */
  const switchToKind = async (kind: DeviceKind | null): Promise<boolean> => {
    const s = get()
    if (!kind || s.mic.status !== 'on') return true
    const id = s.deviceChoice[kind]
    if (!id) {
      s.setStatus(`Pick the ${kind === 'raw' ? 'raw mic' : 'effects'} input with Change.`, true)
      return false
    }
    if (s.mic.deviceId === id) return true
    try {
      setMicOn(await getEngine().open(id))
      return true
    } catch (e) {
      get().setStatus(`Could not open ${labelOf(id) || 'that input'} (${errName(e)}). Pick another with Change.`, true)
      return false
    }
  }

  const finishTake = (samples: Float32Array, sampleRate: number, at: BenchState): void => {
    const st = at.step === 'free' ? null : STEPS[at.step]
    try {
      const analysis = analyze(samples, sampleRate)
      const s = get()
      const fxDist = st?.key === 'fx' && s.fxDist === null ? selectFxDist(s) : s.fxDist
      const devLabel = s.mic.label
      const name = st
        ? fillDistance(st.title, fxDist ?? selectFxDist(s))
        : s.freeTakeName.trim() || `Free take · ${devLabel.replace(/\s*\(.*?\)\s*$/, '') || 'input'}`
      const take: Take = {
        id: Date.now(),
        name,
        session: st ? at.session : 'free',
        step: st ? st.key : null,
        device: devLabel,
        sampleRate,
        samples,
        created: new Date().toISOString(),
        analysis,
      }
      set({
        takes: [...s.takes, take],
        fxDist,
        lastTakeId: take.id,
        ...(st ? {} : { freeTakeName: '' }),
      })
      dbDo((db) => db.put(take))
    } finally {
      set({ recorder: { phase: 'idle', elapsed: 0 } })
    }
  }

  return {
    ...initialBenchState(),

    bootstrap() {
      booting ??= (async () => {
        const ui = loadUiPrefs()
        set({ session: ui.session, A: ui.A, B: ui.B, view: ui.view, fxDist: ui.fxDist, deviceChoice: loadDeviceChoice() })
        const db = await getDb()
        const takes: Take[] = []
        for (const t of await db.all().catch(() => [])) {
          takes.push({ ...t, analysis: analyze(t.samples, t.sampleRate) })
          await yieldToLoop()
        }
        set({ takes, storageAvailable: db.available, ready: true })
        const step: StepRef = ui.step === 'free' || ui.step < STEPS.length ? ui.step : 0
        get().goTo(ui.screen, step)
        if (!getEngine().isSupported()) {
          get().setStatus("This browser can't record here. Open the page via http://localhost in Chrome or Edge.", true)
          return
        }
        try {
          const p = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
          if (p?.state === 'granted') await get().enableMic()
        } catch {
          // permissions API unavailable: wait for the Enable button
        }
      })()
      return booting
    },

    async enableMic() {
      const s0 = get()
      if (s0.mic.status === 'connecting') return
      set({ mic: { ...s0.mic, status: 'connecting', error: null } })
      try {
        const engine = getEngine()
        const kind = guidedKind(get())
        const dev = await engine.openWithFallback((kind && get().deviceChoice[kind]) || undefined)
        const devices = await engine.listInputs()
        const deviceChoice = pickChoices(get().deviceChoice, devices)
        saveDeviceChoice(deviceChoice)
        set({ devices, deviceChoice, status: null })
        setMicOn(dev)
        await switchToKind(guidedKind(get()))
      } catch (e) {
        const msg = `Could not open the microphone (${errName(e)}${errMessage(e) ? ': ' + errMessage(e) : ''}). Allow microphone access in the address bar, then reload.`
        set({ mic: { status: 'error', deviceId: null, label: '', error: msg }, status: { message: msg, error: true } })
      }
    },

    async chooseDevice(kind, deviceId) {
      const deviceChoice = { ...get().deviceChoice, [kind]: deviceId }
      saveDeviceChoice(deviceChoice)
      set({ deviceChoice })
      await openSafe(deviceId)
    },

    previewDevice: (deviceId) => openSafe(deviceId),

    goTo(screen: Screen, step?: StepRef) {
      const s = get()
      if (s.recorder.phase !== 'idle') return
      set({ screen, lastTakeId: null, ...(step !== undefined ? { step } : {}) })
      if (screen === 'results') set(prepareResults(get()))
      if (screen === 'step') void switchToKind(guidedKind(get()))
    },

    next() {
      const s = get()
      if (s.recorder.phase !== 'idle') return
      if (s.step === 'free') {
        set({ A: s.lastTakeId ?? s.A })
        s.goTo('results')
      } else if (s.step < STEPS.length - 1) s.goTo('step', s.step + 1)
      else s.goTo('results')
    },

    back() {
      const s = get()
      if (s.step === 'free') s.goTo('results')
      else if (s.step === 0) s.goTo('setup')
      else s.goTo('step', s.step - 1)
    },

    skip() {
      const s = get()
      if (s.step !== 'free' && s.step < STEPS.length - 1) s.goTo('step', s.step + 1)
      else s.goTo('results')
    },

    async startRecording() {
      const s = get()
      if (s.recorder.phase !== 'idle') return
      if (s.mic.status !== 'on') {
        s.setStatus('Enable the microphone first.', true)
        return
      }
      if (s.step !== 'free' && !(await switchToKind(STEPS[s.step]?.dev ?? null))) return
      if (get().recorder.phase !== 'idle') return
      const engine = getEngine()
      try {
        engine.startRecording()
      } catch (e) {
        get().setStatus(`Could not start recording (${errMessage(e)}).`, true)
        return
      }
      set({ recorder: { phase: 'silence', elapsed: 0 }, status: null })
      stopTimer()
      recTimer = setInterval(() => {
        const t = engine.recordingTime
        if (t >= MAX_SEC) {
          get().stopRecording()
          return
        }
        set({ recorder: { phase: t < QUIET_SEC ? 'silence' : 'reading', elapsed: t } })
      }, TICK_MS)
    },

    stopRecording() {
      const s = get()
      if (s.recorder.phase !== 'silence' && s.recorder.phase !== 'reading') return
      stopTimer()
      const engine = getEngine()
      const samples = engine.stopRecording()
      const sampleRate = engine.sampleRate
      if (samples.length < sampleRate * MIN_SEC) {
        set({ recorder: { phase: 'idle', elapsed: 0 } })
        s.setStatus(
          `Too short (${(samples.length / sampleRate).toFixed(1)} s). Record at least ${MIN_SEC} s: ${QUIET_SEC} s of silence, then the text.`,
          true,
        )
        return
      }
      set({ recorder: { phase: 'analyzing', elapsed: s.recorder.elapsed } })
      // let the UI paint "Analyzing" before the synchronous analysis (prototype waits 30 ms)
      setTimeout(() => finishTake(samples, sampleRate, s), 30)
    },

    toggleRecording() {
      const { phase } = get().recorder
      if (phase === 'idle') void get().startRecording()
      else if (phase === 'silence' || phase === 'reading') get().stopRecording()
    },

    playTake(id) {
      const t = get().takes.find((x) => x.id === id)
      if (t) getEngine().play(t.samples, t.sampleRate)
    },

    stopPlayback() {
      getEngine().stopPlayback()
    },

    setA(id) {
      const s = get()
      const B = s.B === id ? s.A : s.B
      set({ A: id, B: B === id ? null : B })
    },

    toggleB(id) {
      const s = get()
      let B: number | null = s.B === id ? null : id
      if (B === s.A) B = null
      set({ B, view: B === null ? 'a' : s.view === 'a' ? 'ab' : s.view })
    },

    setView: (view) => set({ view }),

    deleteTake(id) {
      const s = get()
      const takes = s.takes.filter((t) => t.id !== id)
      const A = s.A === id ? null : s.A
      const B = s.B === id ? null : s.B
      // the results screen shows the latest analyzed take when A is gone (prototype renderResults)
      const fallbackA = A === null && s.screen === 'results' ? (latestValid(takes)?.id ?? null) : A
      set({ takes, A: fallbackA, B: B === fallbackA ? null : B, lastTakeId: s.lastTakeId === id ? null : s.lastTakeId })
      dbDo((db) => db.remove(id))
    },

    deleteAll() {
      set({ takes: [], A: null, B: null, session: 's' + Date.now(), fxDist: null, lastTakeId: null })
      dbDo((db) => db.clear())
    },

    newSession() {
      if (get().recorder.phase !== 'idle') return
      set({ session: 's' + Date.now(), fxDist: null })
      get().goTo('step', 0)
    },

    startFreeTake: () => get().goTo('step', 'free'),
    setFreeTakeName: (freeTakeName) => set({ freeTakeName }),
    setFxDist: (fxDist) => set({ fxDist }),
    setStatus: (message, error = false) => set({ status: { message, error } }),
    clearStatus: () => set({ status: null }),
  }
})

// ---------- persist UI prefs ----------
const uiPrefsOf = (s: BenchState): UiPrefs => ({
  screen: s.screen,
  step: s.step,
  session: s.session,
  A: s.A,
  B: s.B,
  view: s.view,
  fxDist: s.fxDist,
})
const PREF_KEYS = ['screen', 'step', 'session', 'A', 'B', 'view', 'fxDist'] as const

useBench.subscribe((s, prev) => {
  if (!s.ready) return
  if (!prev.ready || PREF_KEYS.some((k) => s[k] !== prev[k])) saveUiPrefs(uiPrefsOf(s))
})
