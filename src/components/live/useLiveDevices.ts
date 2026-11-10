// The two live inputs: derived from the store's device list each render, the person's pick saved in localStorage.
import { useState } from 'react'
import { useBench } from '../../store/benchStore'
import { loadLiveDevices, pickLiveDevices, saveLiveDevices, type LiveDevices } from './liveDevices'

export interface LiveDevicesApi {
  value: LiveDevices
  set(kind: keyof LiveDevices, id: string | null): void
}

export function useLiveDevices(): LiveDevicesApi {
  const devices = useBench((s) => s.devices)
  const choice = useBench((s) => s.deviceChoice)
  const [pick, setPick] = useState(() => loadLiveDevices())
  const value = pickLiveDevices(devices, choice, pick)
  const set = (kind: keyof LiveDevices, id: string | null): void => {
    const next = { ...value, [kind]: id }
    setPick(next)
    saveLiveDevices(next)
  }
  return { value, set }
}
