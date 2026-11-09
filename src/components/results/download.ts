import { encodeWav, wavFileName } from '../../audio/wav'
import type { Take } from '../../types'

/** Save data as a file through a temporary object URL (prototype downloadFile). */
export function downloadFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Column/heading name: drops "Control · " and shortens "Processed · " to "FX · ". */
export const shortName = (name: string): string =>
  name.replace(/^Control · /, '').replace(/^Processed · /, 'FX · ')

/** Save a take as a 16-bit mono WAV. */
export const downloadTakeWav = (take: Take): void =>
  downloadFile(wavFileName(take.name), encodeWav(take.samples, take.sampleRate), 'audio/wav')
