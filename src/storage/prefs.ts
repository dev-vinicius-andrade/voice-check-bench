// localStorage JSON helpers. Every access is wrapped; bad or missing data yields defaults.
import type { ChartView, DeviceChoice, Screen, StepRef } from '../types'

export interface UiPrefs {
  screen: Screen
  step: StepRef
  session: string
  A: number | null
  B: number | null
  view: ChartView
  fxDist: string | null
}

const UI_KEY = 'vcb-ui'
const DEVS_KEY = 'vcb-devs'
const SCREENS: readonly Screen[] = ['setup', 'step', 'results']
const VIEWS: readonly ChartView[] = ['a', 'ab', 'diff']

export function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked or full: ignore
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const idOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export function defaultUiPrefs(): UiPrefs {
  return { screen: 'setup', step: 0, session: 's' + Date.now(), A: null, B: null, view: 'a', fxDist: null }
}

export function loadUiPrefs(): UiPrefs {
  const d = defaultUiPrefs()
  const raw = readPref<unknown>(UI_KEY, null)
  if (!isObject(raw)) return d
  const step: StepRef =
    raw.step === 'free' || (typeof raw.step === 'number' && Number.isInteger(raw.step) && raw.step >= 0)
      ? raw.step
      : d.step
  return {
    screen: SCREENS.find((s) => s === raw.screen) ?? d.screen,
    step,
    session: typeof raw.session === 'string' && raw.session !== '' ? raw.session : d.session,
    A: idOrNull(raw.A),
    B: idOrNull(raw.B),
    view: VIEWS.find((v) => v === raw.view) ?? d.view,
    fxDist: strOrNull(raw.fxDist),
  }
}

export function saveUiPrefs(p: UiPrefs): void {
  writePref(UI_KEY, p)
}

export function loadDeviceChoice(): DeviceChoice {
  const raw = readPref<unknown>(DEVS_KEY, null)
  if (!isObject(raw)) return { raw: null, fx: null }
  return { raw: strOrNull(raw.raw), fx: strOrNull(raw.fx) }
}

export function saveDeviceChoice(c: DeviceChoice): void {
  writePref(DEVS_KEY, c)
}
