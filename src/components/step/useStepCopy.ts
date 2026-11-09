// Hook form of stepCopy(): binds the active translator, so screens re-render on a language change.
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { StepPart } from '../../session/steps'
import type { StepDef } from '../../types'
import { stepCopy } from './stepCopy'

export function useStepCopy(): (st: StepDef, fxDist: string) => Record<StepPart, string> {
  const { t } = useTranslation()
  return useCallback((st: StepDef, fxDist: string) => stepCopy(st, (k, p) => t(k, p ?? {}), fxDist), [t])
}
