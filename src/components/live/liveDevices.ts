// Live tuning input choices: defaults from the check's choices or Wave Link names, last pick kept in localStorage.
import type { InputDevice } from '../../audio/AudioEngine'
import { readPref, writePref } from '../../storage/prefs'
import type { DeviceChoice } from '../../types'

/** localStorage key for the last live pick. raw null = "None — only the Wave Link output". */
export const LIVE_DEVICES_KEY = 'vcb-live-devices'

export interface LiveDevices {
  raw: string | null
  fx: string | null
}

const WAVE_LINK_OUT = /stream mix|monitor mix|wave link/i

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** The saved pick, or null when nothing (valid) is saved. Storage access is wrapped by readPref. */
export function loadLiveDevices(): Partial<LiveDevices> | null {
  const v = readPref<unknown>(LIVE_DEVICES_KEY, null)
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const out: Partial<LiveDevices> = {}
  if (o.raw === null || isId(o.raw)) out.raw = o.raw
  if (isId(o.fx)) out.fx = o.fx
  return out
}

export function saveLiveDevices(d: LiveDevices): void {
  writePref(LIVE_DEVICES_KEY, d)
}

/** Saved pick when the device still exists; else the check's raw/fx choice; fx falls back to a Wave Link output by name. */
export function pickLiveDevices(devices: readonly InputDevice[], choice: DeviceChoice, saved: Partial<LiveDevices> | null): LiveDevices {
  const has = (id: string | null | undefined): id is string => isId(id) && devices.some((d) => d.deviceId === id)
  const fx = has(saved?.fx) ? saved.fx : has(choice.fx) ? choice.fx : (devices.find((d) => WAVE_LINK_OUT.test(d.label))?.deviceId ?? null)
  let raw: string | null
  if (saved && saved.raw === null) raw = null
  else if (has(saved?.raw)) raw = saved.raw
  else raw = has(choice.raw) && choice.raw !== fx ? choice.raw : null
  return { raw, fx }
}
