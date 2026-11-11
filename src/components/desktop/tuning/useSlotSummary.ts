import { useTranslation } from 'react-i18next'
import { eqBands } from '../../../desktop/advice/chain'
import type { ChainSlot } from '../../../desktop/advice/types'
import { slidersOf } from '../../../desktop/sliderSpecs'
import { fmtSlider } from './sliderFormat'

/** The one-line summary of a collapsed effect card: its values, the band count of ReaEQ, or on/off. */
export function useSlotSummary(slot: ChainSlot): string {
  const { t } = useTranslation()
  const state = t(slot.on ? 'desktop.tune.effects.on' : 'desktop.tune.effects.off')
  if (slot.kind === 'reaeq') return `${state} · ${t('desktop.tune.effects.bands', { count: eqBands(slot).length })}`
  const values = slidersOf(slot).map((s) => `${s.label ?? t('desktop.tune.effects.strength')} ${fmtSlider(s, slot.values[s.key])}`)
  return [state, ...values].join(' · ')
}
