// localStorage JSON helpers. Every access is wrapped; bad or missing data yields defaults.
import { isMainsSetting, type MainsSetting } from '../audio/mains'
import { DEFAULT_MIC } from '../mics/catalog'
import type { ChartView, DeviceChoice, MicProfile, Screen, StepRef } from '../types'

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
const MIC_KEY = 'vcb-mic'
const MAINS_KEY = 'vcb-mains'
const SCREENS: readonly Screen[] = ['home', 'how', 'community', 'privacy', 'setup', 'step', 'results']
const VIEWS: readonly ChartView[] = ['a', 'ab', 'diff']
const MIC_KINDS: readonly MicProfile['kind'][] = ['dynamic', 'condenser', 'unknown']
const MIC_PATTERNS: readonly MicProfile['pattern'][] = ['cardioid', 'supercardioid', 'omni', 'figure8', 'unknown']
const MIC_ADDRESSES: readonly MicProfile['address'][] = ['end', 'side', 'unknown']

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
  // a brand new visitor (no saved prefs) lands on the home page
  return { screen: 'home', step: 0, session: 's' + Date.now(), A: null, B: null, view: 'a', fxDist: null }
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

/** Model stored by older versions when "Other" was picked; it now means "not listed" (model ''). */
const LEGACY_OTHER = 'Other'

/** The person's mic profile ('vcb-mic'); unknown values fall back to 'unknown', bad data to DEFAULT_MIC. */
export function loadMicProfile(): MicProfile {
  const raw = readPref<unknown>(MIC_KEY, null)
  if (!isObject(raw)) return { ...DEFAULT_MIC }
  return {
    model: typeof raw.model === 'string' && raw.model !== LEGACY_OTHER ? raw.model : DEFAULT_MIC.model,
    kind: MIC_KINDS.find((k) => k === raw.kind) ?? DEFAULT_MIC.kind,
    pattern: MIC_PATTERNS.find((p) => p === raw.pattern) ?? DEFAULT_MIC.pattern,
    address: MIC_ADDRESSES.find((a) => a === raw.address) ?? DEFAULT_MIC.address,
  }
}

export function saveMicProfile(m: MicProfile): void {
  writePref(MIC_KEY, m)
}

/** Mains frequency setting ('vcb-mains'): 50, 60 or 'auto' (default, also for bad data). */
export function loadMains(): MainsSetting {
  const raw = readPref<unknown>(MAINS_KEY, 'auto')
  return isMainsSetting(raw) ? raw : 'auto'
}

export function saveMains(m: MainsSetting): void {
  writePref(MAINS_KEY, m)
}
