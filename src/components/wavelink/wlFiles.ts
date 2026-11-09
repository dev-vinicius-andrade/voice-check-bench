// Browser-side file helpers for the Wave Link round trip: backup name, the two downloads, and the optional
// File System Access shortcut (Chrome/Edge). Everything fails soft: the download flow always works.
import { downloadFile } from '../results/download'

const pad = (n: number): string => String(n).padStart(2, '0')

/** `Settings.before-<yyyy-mm-dd-hhmm>.json` in local time. */
export function backupName(d: Date = new Date()): string {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `Settings.before-${day}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}

/** One click: the adjusted Settings.json and the untouched original as a dated backup. */
export function downloadPair(adjusted: string, original: string, now: Date = new Date()): void {
  downloadFile('Settings.json', adjusted, 'application/json')
  downloadFile(backupName(now), original, 'application/json')
}

/** Minimal File System Access surface (not in the TS DOM lib everywhere). */
export interface WlFileHandle {
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
}
type OpenPicker = (opts?: unknown) => Promise<WlFileHandle[]>

const openPicker = (): OpenPicker | null => {
  const w = window as unknown as { showOpenFilePicker?: OpenPicker }
  return typeof w.showOpenFilePicker === 'function' ? w.showOpenFilePicker.bind(window) : null
}

/** True when the browser can pick and save the file directly (Chrome/Edge). */
export const canPickDirectly = (): boolean => openPicker() !== null

/** Pick Settings.json with the File System Access API; null when cancelled or unsupported. */
export async function pickDirectly(): Promise<{ text: string; handle: WlFileHandle } | null> {
  const pick = openPicker()
  if (!pick) return null
  try {
    const [handle] = await pick({ types: [{ description: 'Wave Link settings', accept: { 'application/json': ['.json'] } }] })
    if (!handle) return null
    return { text: await (await handle.getFile()).text(), handle }
  } catch {
    return null
  }
}

/** Write the new text to the picked file; false on any error (the caller falls back to the download flow). */
export async function saveDirectly(handle: WlFileHandle, text: string): Promise<boolean> {
  try {
    const w = await handle.createWritable()
    await w.write(text)
    await w.close()
    return true
  } catch {
    return false
  }
}
