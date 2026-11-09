// Chart labels for the voice goal's target: zero-line label, legend text and the band shift.
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import type { VoiceStyle } from '../../types'
import { toTarget } from './goalTarget'

export interface GoalTarget {
  style: VoiceStyle
  /** "your target" ("reference voice" for natural). */
  zeroLabel: string
  /** "Target: Warm and deep". */
  legend: string
  /** Deviations from the reference voice → deviations from this target. */
  shift: (dev: readonly number[]) => number[]
}

export function useGoalTarget(): GoalTarget {
  const { t } = useTranslation()
  const style = useBench((s) => s.goal.style)
  return {
    style,
    zeroLabel: style === 'natural' ? t('results.chart.zeroReference') : t('results.chart.zeroTarget'),
    legend: t('results.chart.targetLegend', { style: t(`wizard.goal.style.${style}.name`) }),
    shift: (dev) => toTarget(dev, style),
  }
}
