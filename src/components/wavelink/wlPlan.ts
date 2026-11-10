// Plain-language text of a Wave Link change, and the plan of a suggestion.
import type { TFunction } from 'i18next'
import { suggestionToJson } from '../../settings/suggest'
import type { SuggestionJson } from '../../settings/suggest'
import type { AppliedSettings, Refinement, Suggestion } from '../../types'
import type { WlApplyPlan, WlChange } from '../../wavelink/types'
import { loadNrChoice, type NrChoice } from '../guide/nrChoice'
import { ELGATO_NR } from '../guide/waveLinkSteps'

/** What markApplied takes (the store adds id, date and, when absent, the attempt). */
export type AppliedInput = Omit<AppliedSettings, 'id' | 'date' | 'attempt'> & { attempt?: number }

/** The Wave Link plan of a suggestion: its values, and the Elgato effects the chain replaces switched off. */
export function suggestionPlan(s: Suggestion, inputKey: string, off: string[]): WlApplyPlan {
  const json = suggestionToJson(s)
  // With AI noise removal chosen in the guide, ReaFIR is not part of the chain (and Elgato Noise Removal stays on).
  const nr = loadNrChoice()
  if (nr === 'ai-elgato' || nr === 'ai-nvidia') {
    json.chain = json.chain.filter((name) => name !== 'ReaFIR')
    const switchOff = nr === 'ai-elgato' ? off.filter((name) => name !== 'Elgato Noise Removal') : off
    return { inputKey, suggestion: json, switchOff, ...(nr === 'ai-elgato' ? { switchOn: ['Elgato Noise Removal'] } : {}) }
  }
  return { inputKey, suggestion: json, switchOff: off }
}

/** One change in plain words with its values (plugin and field names stay as Wave Link shows them). */
export function changeText(t: TFunction, c: WlChange): string {
  switch (c.kind) {
    case 'onOff':
      return t(c.to === 'off' ? 'profiles.wl.preview.turnOff' : 'profiles.wl.preview.turnOn', { plugin: c.plugin })
    case 'restore':
      return t('profiles.wl.preview.restore', { plugin: c.plugin })
    case 'missing':
      return t('profiles.wl.preview.missing', { plugin: c.plugin })
    case 'bands':
      return t('profiles.wl.preview.bands', { plugin: c.plugin, field: c.field, from: c.from, to: c.to })
    default:
      return t('profiles.wl.preview.value', { plugin: c.plugin, field: c.field, from: c.from, to: c.to })
  }
}

/** Noise-removal route of applied settings: the AI remover picked in the guide, else ReaFIR when it is in the chain, else none. */
export function noiseRemovalOf(json: SuggestionJson, choice: NrChoice | null): AppliedSettings['noiseRemoval'] {
  if ((choice === 'ai-elgato' || choice === 'ai-nvidia') && json.noiseReduction) return choice
  return json.chain.includes('ReaFIR') ? 'reafir' : 'none'
}

/** markApplied input for a plan the person downloaded/saved (the plan's suggestion JSON, at the suggestion distance). */
export function appliedFromPlan(plan: WlApplyPlan, dist: string, choice: NrChoice | null, attempt?: number): AppliedInput | null {
  if (!plan.suggestion) return null
  const noiseRemoval = noiseRemovalOf(plan.suggestion, choice)
  return { settings: plan.suggestion, noiseRemoval, dist, ...(attempt === undefined ? {} : { attempt }) }
}

/** The Wave Link plan of a refinement: its settings, with the noise-removal route it asks for. */
export function refinedPlan(r: Refinement, inputKey: string): WlApplyPlan {
  const off = ['Voice Focus', 'Elgato EQ', ...(r.settings.deess ? [] : ['Elgato De-Esser'])]
  if (r.noiseRemoval === 'ai-elgato' || r.noiseRemoval === 'ai-nvidia') {
    const suggestion = { ...r.settings, chain: r.settings.chain.filter((name) => name !== 'ReaFIR') }
    if (r.noiseRemoval === 'ai-elgato') return { inputKey, suggestion, switchOff: off, switchOn: [ELGATO_NR] }
    return { inputKey, suggestion, switchOff: [...off, ELGATO_NR] }
  }
  return { inputKey, suggestion: r.settings, switchOff: [...off, ELGATO_NR] }
}

/** markApplied input for a suggestion set up by hand (same JSON the Wave Link plan would write). */
export function appliedFromSuggestion(s: Suggestion): AppliedInput {
  const json = suggestionPlan(s, '', []).suggestion ?? suggestionToJson(s)
  return { settings: json, noiseRemoval: noiseRemovalOf(json, loadNrChoice()), dist: s.dist }
}
