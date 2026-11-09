// Plain-language text of a Wave Link change, and the plan of a suggestion.
import type { TFunction } from 'i18next'
import { suggestionToJson } from '../../settings/suggest'
import type { Suggestion } from '../../types'
import type { WlApplyPlan, WlChange } from '../../wavelink/types'
import { loadNrChoice } from '../guide/nrChoice'

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
