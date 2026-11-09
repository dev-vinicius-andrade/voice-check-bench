// The Wave Link + ReaPlugs walk-through as an ordered list of steps, built from the suggestion. Pure.
import type { Suggestion } from '../../types'
import { chainOf } from '../results/pluginCards'

export type ReaFirPhase = 'setup' | 'profile' | 'reduce'

export type WaveLinkStepKind = 'effects' | 'add' | 'reafir' | 'eq' | 'eqFlat' | 'comp' | 'gate' | 'lowcut' | 'test'

export interface WaveLinkStep {
  /** Unique within the list (React key, progress checklist). */
  id: string
  kind: WaveLinkStepKind
  /** Plugin the step is about ('add' and the panel steps). */
  plugin?: string
  /** 1-based position of the plugin in the chain ('add'). */
  position?: number
  /** ReaFIR phase ('reafir'). */
  phase?: ReaFirPhase
  /** 0-based EQ band ('eq'). */
  band?: number
}

/** Elgato effects to switch off: the ones the suggested chain replaces. De-Esser stays on when the suggestion wants it. */
export function offEffects(s: Suggestion): string[] {
  return ['Voice Focus', 'Elgato EQ', ...(s.deess ? [] : ['Elgato De-Esser']), 'Elgato Noise Removal']
}

/** Panel steps of one plugin, after its "add" step. Unknown plugins get no panel. */
function panelSteps(s: Suggestion, plugin: string): WaveLinkStep[] {
  switch (plugin) {
    case 'ReaFIR':
      return (['setup', 'profile', 'reduce'] as const).map((phase) => ({ id: `reafir-${phase}`, kind: 'reafir', plugin, phase }))
    case 'ReaEQ':
      return s.eq.length
        ? s.eq.map((_, band) => ({ id: `eq-${band}`, kind: 'eq', plugin, band }))
        : [{ id: 'eq-flat', kind: 'eqFlat', plugin }]
    case 'ReaComp':
      return [{ id: 'comp', kind: 'comp', plugin }]
    case 'ReaGate':
      return [{ id: 'gate', kind: 'gate', plugin }]
    default:
      return []
  }
}

/** effects → (add + panel steps) per plugin in chain order → hardware low cut → test. */
export function waveLinkSteps(s: Suggestion): WaveLinkStep[] {
  const chain = chainOf(s)
  return [
    { id: 'effects', kind: 'effects' },
    ...chain.flatMap((plugin, i): WaveLinkStep[] => [
      { id: `add-${plugin}`, kind: 'add', plugin, position: i + 1 },
      ...panelSteps(s, plugin),
    ]),
    { id: 'lowcut', kind: 'lowcut' },
    { id: 'test', kind: 'test' },
  ]
}
