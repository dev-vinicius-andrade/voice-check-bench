// Equalizer APO actuator adapter: maps abstract EQ-only ActuatorCommands to config.ini filter lines.
// Equalizer APO uses a text-based config file with Filter/Preamplification directives.
// Framework-free: no React, no Tauri. This adapter renders human-readable config lines
// and plain-language setup steps; actual file writing requires a future Tauri command.
import type { ActuatorAdapter, ActuatorCommand, ActuatorCapability } from '../../plain/actuator'
import { registerAdapter } from '../../plain/actuator'
import type { Msg } from '../../plain/types'

const msg = (key: string, params?: Record<string, string | number>): Msg => (params ? { key, params } : { key })

/** The command types this adapter can render as Equalizer APO config lines. */
const HANDLED: readonly ActuatorCommand['type'][] = [
  'highpass', 'eqCut', 'eqBoost', 'lowShelf', 'highShelf',
] as const

export const equalizerApoCapability: ActuatorCapability = {
  id: 'equalizer-apo',
  name: 'Equalizer APO',
  handles: HANDLED,
}

/** Round to one decimal place for clean config output. */
const r1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1)

/**
 * Render an abstract EQ command as an Equalizer APO config.ini filter line.
 * Returns null for unsupported command types.
 *
 * Equalizer APO filter syntax:
 *   Filter <n>: ON HP Fc <freq> Hz    (high-pass)
 *   Filter <n>: ON LS Fc <freq> Hz Gain <gain> dB   (low shelf)
 *   Filter <n>: ON HS Fc <freq> Hz Gain <gain> dB   (high shelf)
 *   Filter <n>: ON PK Fc <freq> Hz Gain <gain> dB Q <q>   (peaking EQ)
 *
 * Q is derived from bandwidth in octaves: Q = sqrt(2^bw) / (2^bw - 1) ≈ 1/(bw * ln(2))
 * For simplicity we use Q ≈ 1/bw which is close enough for typical voice EQ widths.
 */
export function renderConfigLine(cmd: ActuatorCommand, filterIndex: number): string | null {
  switch (cmd.type) {
    case 'highpass':
      return `Filter ${filterIndex}: ON HP Fc ${r1(cmd.freqHz)} Hz`

    case 'eqCut':
    case 'eqBoost': {
      // Q from octave bandwidth: approximate as 1/bw for voice-range widths (0.5–2 oct)
      const q = Math.max(0.1, 1 / cmd.bwOct)
      return `Filter ${filterIndex}: ON PK Fc ${r1(cmd.freqHz)} Hz Gain ${r1(cmd.gainDb)} dB Q ${r1(q)}`
    }

    case 'lowShelf':
      return `Filter ${filterIndex}: ON LS Fc ${r1(cmd.freqHz)} Hz Gain ${r1(cmd.gainDb)} dB`

    case 'highShelf':
      return `Filter ${filterIndex}: ON HS Fc ${r1(cmd.freqHz)} Hz Gain ${r1(cmd.gainDb)} dB`

    default:
      return null
  }
}

/**
 * Render a full config.ini snippet for a list of commands.
 * Filters are numbered starting from `startFilter` (default 1).
 * Returns only lines for supported commands; unsupported ones are silently skipped.
 */
export function renderConfig(commands: readonly ActuatorCommand[], startFilter = 1): string {
  const lines: string[] = []
  let idx = startFilter
  for (const cmd of commands) {
    const line = renderConfigLine(cmd, idx)
    if (line !== null) {
      lines.push(line)
      idx++
    }
  }
  return lines.join('\n')
}

export const equalizerApoAdapter: ActuatorAdapter = {
  capability: equalizerApoCapability,

  canHandle(cmd: ActuatorCommand): boolean {
    return (HANDLED as readonly string[]).includes(cmd.type)
  },

  renderSteps(cmd: ActuatorCommand): Msg[] {
    const line = renderConfigLine(cmd, 1)
    if (!line) return [msg('desktop.advice.steps.equalizerApo.unsupported')]
    return [
      msg('desktop.advice.steps.equalizerApo.openConfig'),
      msg('desktop.advice.steps.equalizerApo.addLine', { line }),
      msg('desktop.advice.steps.equalizerApo.save'),
    ]
  },
}

/** Register the Equalizer APO adapter in the global registry. Call once at app startup when detected. */
export function registerEqualizerApoAdapter(): void {
  registerAdapter(equalizerApoAdapter)
}