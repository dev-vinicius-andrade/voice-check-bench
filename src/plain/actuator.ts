// Abstract actuator interface: decouples recommendations from any specific audio host or plugin.
// Framework-free: no React, no Tauri. Each adapter maps ActuatorCommand → host-specific steps.
import type { Msg } from './types'

/** An abstract audio fix that any capable actuator can carry out. */
export type ActuatorCommand =
  | { type: 'highpass'; freqHz: number; slopeDbPerOct?: number }
  | { type: 'eqCut'; freqHz: number; gainDb: number; bwOct: number }
  | { type: 'eqBoost'; freqHz: number; gainDb: number; bwOct: number }
  | { type: 'lowShelf'; freqHz: number; gainDb: number }
  | { type: 'highShelf'; freqHz: number; gainDb: number }
  | { type: 'noiseSubtract'; profileNote: string }
  | { type: 'gate'; thresholdDb: number }
  | { type: 'compress'; thresholdDb: number; ratio: number }
  | { type: 'deess' }

/** What an actuator can do. Returned by adapters so the classifier knows what to offer. */
export interface ActuatorCapability {
  /** Unique id for this actuator (e.g. 'reaplugs', 'equalizer-apo', 'obs-filters', 'windows-sound'). */
  id: string
  /** Human-readable name for UI display. Never translated (product name). */
  name: string
  /** Which command types this actuator supports. */
  handles: readonly ActuatorCommand['type'][]
}

/**
 * An adapter that turns abstract commands into concrete instructions for a specific audio host.
 * Pure functions only — no side effects, no imports from React/Tauri/Wave Link.
 */
export interface ActuatorAdapter {
  capability: ActuatorCapability
  /** Whether this adapter can carry out the given command. */
  canHandle(cmd: ActuatorCommand): boolean
  /** Plain-language steps the user follows in this host's UI to apply the command. */
  renderSteps(cmd: ActuatorCommand): Msg[]
}

/** Registry of available actuators. Adapters register here; the classifier picks the best match. */
const adapters: ActuatorAdapter[] = []

export function registerAdapter(a: ActuatorAdapter): void {
  adapters.push(a)
}

export function getAdapters(): readonly ActuatorAdapter[] {
  return adapters
}

/** Find the first adapter that can handle a command, or null. */
export function findAdapter(cmd: ActuatorCommand): ActuatorAdapter | null {
  return adapters.find((a) => a.canHandle(cmd)) ?? null
}

/** Check whether any registered adapter can handle a command. */
export function hasAdapterFor(cmd: ActuatorCommand): boolean {
  return adapters.some((a) => a.canHandle(cmd))
}