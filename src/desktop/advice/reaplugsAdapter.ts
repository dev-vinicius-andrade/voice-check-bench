// ReaPlugs actuator adapter: maps abstract ActuatorCommands to concrete ChainSlot Changes
// for Wave Link's ReaPlugs chain (ReaGate, ReaComp, ReaEQ, ReaFIR). Framework-free.
import type { ActuatorAdapter, ActuatorCommand, ActuatorCapability } from '../../plain/actuator'
import { registerAdapter } from '../../plain/actuator'
import type { Change, ChainSlot, ValueChange } from './types'
import { eqBands, eqKey, slotsWith } from './chain'
import { EQ_TYPES } from '../../wavelink/fxp'

const msg = (key: string, params?: Record<string, string | number>) => (params ? { key, params } : { key })

/** The command types this adapter can turn into ReaPlugs chain changes. */
const HANDLED: readonly ActuatorCommand['type'][] = [
  'highpass', 'eqCut', 'eqBoost', 'lowShelf', 'highShelf',
  'noiseSubtract', 'gate', 'compress', 'deess',
] as const

export const replugsCapability: ActuatorCapability = {
  id: 'reaplugs',
  name: 'Wave Link ReaPlugs',
  handles: HANDLED,
}

/** Find a free (disabled) ReaEQ band in the given slot, or null if none available. */
function freeEqBand(slot: ChainSlot): number | null {
  const bands = eqBands(slot)
  for (const b of bands) {
    if (!b.on) return b.n
  }
  return null
}

/** Build a ValueChange for an EQ band field. */
function eqValueChange(
  reason: string,
  slotIndex: number,
  band: number,
  field: 'type' | 'on' | 'freqHz' | 'gainDb' | 'bwOct',
  from: number,
  to: number,
): ValueChange {
  return {
    kind: 'value',
    id: `${reason}:${slotIndex}:${eqKey(band, field)}`,
    reason: reason as ValueChange['reason'],
    titleMsg: msg('desktop.advice.title.reaplugsEq'),
    slot: slotIndex,
    key: eqKey(band, field),
    from,
    to,
  }
}

/** Turn an abstract command into concrete chain changes, or null when the chain can't carry it out. */
export function applyCommand(cmd: ActuatorCommand, chain: readonly ChainSlot[]): Change[] | null {
  switch (cmd.type) {
    case 'highpass': {
      const eqSlot = slotsWith(chain, 'reaeq', eqKey(1, 'freqHz'))[0]
      if (!eqSlot) return null
      const band = freeEqBand(eqSlot)
      if (band === null) return null
      const changes: Change[] = []
      const v = eqSlot.values
      changes.push(eqValueChange('tone', eqSlot.index, band, 'type', v[eqKey(band, 'type')] ?? 8, EQ_TYPES.Band))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'freqHz', v[eqKey(band, 'freqHz')] ?? 0, cmd.freqHz))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'gainDb', v[eqKey(band, 'gainDb')] ?? 0, -48))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'bwOct', v[eqKey(band, 'bwOct')] ?? 1, cmd.slopeDbPerOct ? cmd.slopeDbPerOct / 6 : 1))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'on', v[eqKey(band, 'on')] ?? 0, 1))
      return changes
    }

    case 'eqCut':
    case 'eqBoost': {
      const eqSlot = slotsWith(chain, 'reaeq', eqKey(1, 'freqHz'))[0]
      if (!eqSlot) return null
      const band = freeEqBand(eqSlot)
      if (band === null) return null
      const v = eqSlot.values
      const changes: Change[] = []
      changes.push(eqValueChange('tone', eqSlot.index, band, 'type', v[eqKey(band, 'type')] ?? 8, EQ_TYPES.Band))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'freqHz', v[eqKey(band, 'freqHz')] ?? 0, cmd.freqHz))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'gainDb', v[eqKey(band, 'gainDb')] ?? 0, cmd.gainDb))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'bwOct', v[eqKey(band, 'bwOct')] ?? 1, cmd.bwOct))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'on', v[eqKey(band, 'on')] ?? 0, 1))
      return changes
    }

    case 'lowShelf': {
      const eqSlot = slotsWith(chain, 'reaeq', eqKey(1, 'freqHz'))[0]
      if (!eqSlot) return null
      // Use band 1 (typically the low shelf band)
      const band = 1
      const v = eqSlot.values
      const changes: Change[] = []
      changes.push(eqValueChange('tone', eqSlot.index, band, 'type', v[eqKey(band, 'type')] ?? 0, EQ_TYPES['Low Shelf']))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'freqHz', v[eqKey(band, 'freqHz')] ?? 0, cmd.freqHz))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'gainDb', v[eqKey(band, 'gainDb')] ?? 0, cmd.gainDb))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'on', v[eqKey(band, 'on')] ?? 0, 1))
      return changes
    }

    case 'highShelf': {
      const eqSlot = slotsWith(chain, 'reaeq', eqKey(1, 'freqHz'))[0]
      if (!eqSlot) return null
      // Use the last band (typically the high shelf band)
      const bands = eqBands(eqSlot)
      if (bands.length === 0) return null
      const band = bands[bands.length - 1].n
      const v = eqSlot.values
      const changes: Change[] = []
      changes.push(eqValueChange('tone', eqSlot.index, band, 'type', v[eqKey(band, 'type')] ?? 1, EQ_TYPES['High Shelf']))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'freqHz', v[eqKey(band, 'freqHz')] ?? 0, cmd.freqHz))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'gainDb', v[eqKey(band, 'gainDb')] ?? 0, cmd.gainDb))
      changes.push(eqValueChange('tone', eqSlot.index, band, 'on', v[eqKey(band, 'on')] ?? 0, 1))
      return changes
    }

    case 'noiseSubtract': {
      const reafir = chain.find((s) => s.kind === 'reafir')
      if (!reafir) return null
      if (!reafir.on) {
        return [{
          kind: 'switch',
          id: `noise:${reafir.index}:on`,
          reason: 'noisyPause',
          titleMsg: msg('desktop.advice.title.reaplugsNoiseSubtract'),
          slot: reafir.index,
          on: true,
        }]
      }
      // Already on; nothing to change
      return []
    }

    case 'gate': {
      const gateSlot = chain.find((s) => s.kind === 'reagate')
      if (!gateSlot) return null
      const changes: Change[] = []
      // If gate is off, turn it on
      if (!gateSlot.on) {
        changes.push({
          kind: 'switch',
          id: `noise:${gateSlot.index}:on`,
          reason: 'noisyPause',
          titleMsg: msg('desktop.advice.title.reaplugsGate'),
          slot: gateSlot.index,
          on: true,
        })
      }
      const currentThreshold = gateSlot.values.thresholdDb
      if (currentThreshold !== undefined && Math.abs(currentThreshold - cmd.thresholdDb) > 0.5) {
        changes.push({
          kind: 'value',
          id: `noise:${gateSlot.index}:thresholdDb`,
          reason: 'noisyPause',
          titleMsg: msg('desktop.advice.title.reaplugsGate'),
          slot: gateSlot.index,
          key: 'thresholdDb',
          from: currentThreshold,
          to: cmd.thresholdDb,
        })
      }
      return changes.length > 0 ? changes : null
    }

    case 'compress': {
      const compSlot = chain.find((s) => s.kind === 'reacomp')
      if (!compSlot) return null
      const changes: Change[] = []
      if (!compSlot.on) {
        changes.push({
          kind: 'switch',
          id: `gain:${compSlot.index}:on`,
          reason: 'tooQuiet',
          titleMsg: msg('desktop.advice.title.reaplugsComp'),
          slot: compSlot.index,
          on: true,
        })
      }
      const curThresh = compSlot.values.thresholdDb
      if (curThresh !== undefined && Math.abs(curThresh - cmd.thresholdDb) > 0.5) {
        changes.push({
          kind: 'value',
          id: `gain:${compSlot.index}:thresholdDb`,
          reason: 'tooQuiet',
          titleMsg: msg('desktop.advice.title.reaplugsComp'),
          slot: compSlot.index,
          key: 'thresholdDb',
          from: curThresh,
          to: cmd.thresholdDb,
        })
      }
      const curRatio = compSlot.values.ratio
      if (curRatio !== undefined && Math.abs(curRatio - cmd.ratio) > 0.1) {
        changes.push({
          kind: 'value',
          id: `gain:${compSlot.index}:ratio`,
          reason: 'tooQuiet',
          titleMsg: msg('desktop.advice.title.reaplugsComp'),
          slot: compSlot.index,
          key: 'ratio',
          from: curRatio,
          to: cmd.ratio,
        })
      }
      return changes.length > 0 ? changes : null
    }

    case 'deess': {
      const deesser = chain.find((s) => s.kind === 'deesser')
      if (!deesser) return null
      if (!deesser.on) {
        return [{
          kind: 'switch',
          id: `tone:${deesser.index}:on`,
          reason: 'tone',
          titleMsg: msg('desktop.advice.title.reaplugsDeess'),
          slot: deesser.index,
          on: true,
        }]
      }
      return []
    }

    default:
      return null
  }
}

export const replugsAdapter: ActuatorAdapter = {
  capability: replugsCapability,
  canHandle(cmd: ActuatorCommand): boolean {
    return (HANDLED as readonly string[]).includes(cmd.type)
  },
  renderSteps(cmd: ActuatorCommand) {
    return [msg(`desktop.advice.steps.reaplugs.${cmd.type}`)]
  },
}

/** Register the ReaPlugs adapter in the global registry. Call once at app startup. */
export function registerReaplugsAdapter(): void {
  registerAdapter(replugsAdapter)
}