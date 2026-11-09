// State of an uploaded Wave Link Settings.json: parsed file, chosen mic input, optional direct-save handle, error.
import { useState } from 'react'
import { parseSettings } from '../../wavelink/codec'
import type { WlFile } from '../../wavelink/types'
import type { WlFileHandle } from './wlFiles'

export type WlFileError = 'invalid' | 'noInputs' | 'read'

export interface WaveLinkFileState {
  file: WlFile | null
  inputKey: string
  handle: WlFileHandle | null
  error: WlFileError | null
  /** Parse a file's text; keeps the handle when it came from the direct picker. */
  load(text: string, handle?: WlFileHandle | null): void
  loadFile(f: File): Promise<void>
  setInputKey(key: string): void
  reset(): void
}

/** Parse text into a WlFile; null + reason when it is not a Wave Link settings file with a mic input. */
export function readSettings(text: string): { file: WlFile | null; error: WlFileError | null } {
  try {
    const file = parseSettings(text)
    if (!file) return { file: null, error: 'invalid' }
    if (file.inputs.length === 0) return { file: null, error: 'noInputs' }
    return { file, error: null }
  } catch {
    return { file: null, error: 'invalid' }
  }
}

export function useWaveLinkFile(): WaveLinkFileState {
  const [file, setFile] = useState<WlFile | null>(null)
  const [inputKey, setInputKey] = useState('')
  const [handle, setHandle] = useState<WlFileHandle | null>(null)
  const [error, setError] = useState<WlFileError | null>(null)

  const load = (text: string, h: WlFileHandle | null = null): void => {
    const r = readSettings(text)
    setFile(r.file)
    setError(r.error)
    setHandle(r.file ? h : null)
    setInputKey(r.file?.inputs[0]?.key ?? '')
  }
  const loadFile = async (f: File): Promise<void> => {
    try {
      load(await f.text())
    } catch {
      setFile(null)
      setError('read')
    }
  }
  const reset = (): void => {
    setFile(null)
    setHandle(null)
    setError(null)
    setInputKey('')
  }
  return { file, inputKey, handle, error, load, loadFile, setInputKey, reset }
}
