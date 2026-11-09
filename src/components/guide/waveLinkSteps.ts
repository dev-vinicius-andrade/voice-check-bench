// The Wave Link + ReaPlugs walk-through as an ordered list of steps, built from the suggestion. Pure.
import type { Suggestion } from '../../types'
import { chainOf } from '../results/pluginCards'
import type { NrChoice } from './nrChoice'

export type ReaFirPhase = 'setup' | 'profile' | 'reduce'

export type WaveLinkStepKind = 'effects' | 'ai' | 'add' | 'reafir' | 'eq' | 'eqFlat' | 'comp' | 'gate' | 'lowcut' | 'listen' | 'test'

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

export const ELGATO_NR = 'Elgato Noise Removal'

/** True when the suggestion wants AI noise removal tried before ReaFIR (voice less than 15 dB over the room). */
export const prefersAi = (s: Suggestion): boolean => !!s.noiseReduction?.preferAi

/** The choice that applies to this suggestion: only when AI noise removal is suggested first. */
export const effectiveChoice = (s: Suggestion, choice: NrChoice | null): NrChoice | null => (prefersAi(s) ? choice : null)

/**
 * Effects as they end up in Wave Link: with an AI noise remover picked, ReaFIR is skipped
 * (Elgato Noise Removal takes the first position; NVIDIA Broadcast works outside Wave Link).
 */
export function guideChain(s: Suggestion, choice: NrChoice | null = null): string[] {
  const chain = chainOf(s)
  const c = effectiveChoice(s, choice)
  if (c === 'ai-elgato') return [ELGATO_NR, ...chain.filter((p) => p !== 'ReaFIR')]
  if (c === 'ai-nvidia') return chain.filter((p) => p !== 'ReaFIR')
  return chain
}

/**
 * Elgato effects to switch off: the ones the suggested chain replaces. De-Esser stays on when the suggestion wants it.
 * Elgato Noise Removal stays on when the person picked it, and is not switched off before the choice is made.
 */
export function offEffects(s: Suggestion, choice: NrChoice | null = null): string[] {
  const c = effectiveChoice(s, choice)
  const keepNr = c === 'ai-elgato' || (prefersAi(s) && c === null)
  return ['Voice Focus', 'Elgato EQ', ...(s.deess ? [] : ['Elgato De-Esser']), ...(keepNr ? [] : [ELGATO_NR])]
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

/**
 * effects → [AI noise removal first, when preferAi] → (add + panel steps) per plugin in chain order → hardware low cut
 * → [listen check, with noise removal] → test. Elgato Noise Removal is set up in the AI step, so it gets no add step.
 */
export function waveLinkSteps(s: Suggestion, choice: NrChoice | null = null): WaveLinkStep[] {
  const chain = guideChain(s, choice)
  return [
    { id: 'effects', kind: 'effects' },
    ...(prefersAi(s) ? [{ id: 'ai', kind: 'ai' } as const] : []),
    ...chain.flatMap((plugin, i): WaveLinkStep[] =>
      plugin === ELGATO_NR ? [] : [{ id: `add-${plugin}`, kind: 'add', plugin, position: i + 1 }, ...panelSteps(s, plugin)],
    ),
    { id: 'lowcut', kind: 'lowcut' },
    ...(s.noiseReduction ? [{ id: 'listen', kind: 'listen' } as const] : []),
    { id: 'test', kind: 'test' },
  ]
}
