import { useEffect, useState } from 'react'
import type { DesktopBridge } from '../../../desktop/bridge'
import { errorMsg } from '../../../desktop/errors'
import type { AudioDevices } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'

export interface DeviceChoice {
  devices: AudioDevices | null
  inputId: string
  outputId: string
  setInputId: (id: string) => void
  setOutputId: (id: string) => void
}

/** The engine's capture/render devices, once per mount, with its defaults picked. */
export function useAudioDevices(bridge: DesktopBridge, setError: (m: Msg | null) => void): DeviceChoice {
  const [devices, setDevices] = useState<AudioDevices | null>(null)
  const [inputId, setInputId] = useState('')
  const [outputId, setOutputId] = useState('')
  useEffect(() => {
    let alive = true
    bridge.audioDevices().then(
      (d) => {
        if (!alive) return
        setDevices(d)
        setInputId(d.defaultInputId ?? d.inputs[0]?.id ?? '')
        setOutputId(d.defaultOutputId ?? d.outputs[0]?.id ?? '')
      },
      (e: unknown) => alive && setError(errorMsg(e)),
    )
    return () => {
      alive = false
    }
  }, [bridge, setError])
  return { devices, inputId, outputId, setInputId, setOutputId }
}
