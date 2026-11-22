// Actuator discovery: detects installed audio software so the classifier knows which adapters to register.
// Framework-free: no React, no Tauri imports. Detection results are plain data; the bridge calls these
// from Tauri commands or the web fallback reads localStorage.
import type { ActuatorCapability } from '../plain/actuator'

/** A detected actuator on the user's machine. */
export interface DetectedActuator {
  /** Matches ActuatorCapability.id (e.g. 'reaplugs', 'equalizer-apo'). */
  id: string
  /** Human-readable product name. Never translated. */
  name: string
  /** When this actuator was last confirmed present (ISO 8601). */
  detectedAt: string
  /** Optional metadata (install path, version, config file location). */
  meta?: Record<string, string>
}

/** The full discovery result, persisted to localStorage under ACTUATORS_KEY. */
export interface ActuatorsState {
  /** Currently detected actuators, keyed by id. */
  detected: Record<string, DetectedActuator>
  /** When discovery last ran (ISO 8601), or null if never. */
  lastScanAt: string | null
}

export const ACTUATORS_KEY = 'vcb-actuators'

export function defaultActuatorsState(): ActuatorsState {
  return { detected: {}, lastScanAt: null }
}

/** Load persisted actuators state from localStorage. Returns defaults on any error. */
export function loadActuatorsState(): ActuatorsState {
  try {
    const raw = localStorage.getItem(ACTUATORS_KEY)
    if (!raw) return defaultActuatorsState()
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || !('detected' in parsed)) return defaultActuatorsState()
    const state = parsed as Record<string, unknown>
    const detected: Record<string, DetectedActuator> = {}
    if (typeof state.detected === 'object' && state.detected !== null) {
      for (const [id, val] of Object.entries(state.detected as Record<string, unknown>)) {
        if (typeof val === 'object' && val !== null && 'name' in val && 'detectedAt' in val) {
          detected[id] = val as DetectedActuator
        }
      }
    }
    return {
      detected,
      lastScanAt: typeof state.lastScanAt === 'string' ? state.lastScanAt : null,
    }
  } catch {
    return defaultActuatorsState()
  }
}

/** Persist actuators state to localStorage. Silently ignores storage errors. */
export function saveActuatorsState(state: ActuatorsState): void {
  try {
    localStorage.setItem(ACTUATORS_KEY, JSON.stringify(state))
  } catch {
    // storage blocked or full: ignore
  }
}

/**
 * Merge a detection result into existing state. New detections are added; missing ones are removed
 * only when `fullScan` is true (a partial scan doesn't erase previously detected actuators).
 */
export function mergeDetection(
  prev: ActuatorsState,
  found: readonly DetectedActuator[],
  fullScan: boolean,
): ActuatorsState {
  const detected = { ...prev.detected }
  const now = new Date().toISOString()
  for (const a of found) {
    detected[a.id] = { ...a, detectedAt: now }
  }
  if (fullScan) {
    const ids = new Set(found.map((a) => a.id))
    for (const id of Object.keys(detected)) {
      if (!ids.has(id)) delete detected[id]
    }
  }
  return { detected, lastScanAt: now }
}

/** Wave Link detection: checks for Settings.json at known paths. Returns a DetectedActuator or null. */
export function detectWaveLink(): DetectedActuator | null {
  // Wave Link stores Settings.json next to its executable. Common install paths:
  const candidates = [
    '%LOCALAPPDATA%/Elgato/WaveLink/Settings.json',
    '%PROGRAMFILES%/Elgato/WaveLink/Settings.json',
    '%PROGRAMFILES(X86)%/Elgato/WaveLink/Settings.json',
  ]
  // On the web we can't check the filesystem; this function is called from a Tauri command
  // that resolves these paths. Here we return null as a placeholder — the real detection
  // happens in the Rust backend via the `detect_actuators` command.
  // This pure-TS fallback exists for testing and for the web build (which has no actuators).
  void candidates
  return null
}

/** Build an ActuatorCapability from a DetectedActuator, for adapter registration. */
export function capabilityOf(a: DetectedActuator): ActuatorCapability | null {
  switch (a.id) {
    case 'reaplugs':
      return {
        id: 'reaplugs',
        name: a.name,
        handles: ['highpass', 'eqCut', 'eqBoost', 'lowShelf', 'highShelf', 'noiseSubtract', 'gate', 'compress', 'deess'],
      }
    case 'equalizer-apo':
      return {
        id: 'equalizer-apo',
        name: a.name,
        // Equalizer APO supports parametric EQ and filters; no noise reduction, gate or compressor built-in.
        handles: ['highpass', 'eqCut', 'eqBoost', 'lowShelf', 'highShelf'],
      }
    default:
      return null
  }
}