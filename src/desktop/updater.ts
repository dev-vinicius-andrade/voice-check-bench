// Auto-update (SPEC "Desktop app (v2.0)" Distribution). Framework-free. The updater/process plugins are imported
// lazily and only inside the desktop app; every failure is soft (logged, then null/false) so the app never breaks
// because the feed or the network is unavailable.
import { isDesktop } from './bridge'

/** Download progress: bytes so far and the total when the server sent a length. */
export interface UpdateProgress {
  downloaded: number
  total: number | null
}

/** A newer version announced by the feed. */
export interface AvailableUpdate {
  version: string
  notes?: string
  /** Downloads, installs and relaunches. Resolves false when any step failed (the app keeps running). */
  install(onProgress?: (p: UpdateProgress) => void): Promise<boolean>
  /** Releases the update without installing it. */
  dismiss(): Promise<void>
}

export type CheckForUpdate = () => Promise<AvailableUpdate | null>

/** How often the app asks the feed again while it stays open. */
export const UPDATE_RECHECK_MS = 30 * 60 * 1000

/** Looks for an update now; resolves true when one is on offer. */
export type ManualUpdateCheck = () => Promise<boolean>

let manual: ManualUpdateCheck | null = null

/** The update notice registers how "check now" is done; returns the unregister. */
export function onManualUpdateCheck(handler: ManualUpdateCheck): () => void {
  manual = handler
  return () => {
    if (manual === handler) manual = null
  }
}

/** "Check for updates" pressed: true when an update is on offer, false when none was found (or the check failed). */
export const requestUpdateCheck: ManualUpdateCheck = () => (manual ? manual() : Promise.resolve(false))

const warn = (what: string, err: unknown) => console.warn(`[updater] ${what} failed:`, err)

/** Asks the feed for a newer version. Null on the web, when up to date, or when the check failed. */
export const checkForUpdate: CheckForUpdate = async () => {
  if (!isDesktop()) return null
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return null
    return {
      version: update.version,
      notes: update.body,
      async install(onProgress) {
        try {
          let downloaded = 0
          let total: number | null = null
          await update.downloadAndInstall((e) => {
            if (e.event === 'Started') total = e.data.contentLength ?? null
            else if (e.event === 'Progress') downloaded += e.data.chunkLength
            else if (e.event === 'Finished' && total !== null) downloaded = total
            onProgress?.({ downloaded, total })
          })
        } catch (err) {
          warn('install', err)
          return false
        }
        try {
          const { relaunch } = await import('@tauri-apps/plugin-process')
          await relaunch()
          return true
        } catch (err) {
          warn('relaunch', err)
          return false
        }
      },
      async dismiss() {
        try {
          await update.close()
        } catch (err) {
          warn('close', err)
        }
      },
    }
  } catch (err) {
    warn('check', err)
    return null
  }
}
