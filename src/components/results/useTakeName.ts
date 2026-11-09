// On-screen take names: guided takes by their translated step title (stored names are English data),
// free takes by the name the person gave them.
import { useCallback } from 'react'
import { stepOf, takeDist } from '../../session/steps'
import type { StoredTake } from '../../types'
import { useStepCopy } from '../step/useStepCopy'

export type TakeNamer = (take: Pick<StoredTake, 'step' | 'name'>) => string

export function useTakeName(): TakeNamer {
  const copy = useStepCopy()
  return useCallback<TakeNamer>(
    (take) => {
      const st = stepOf(take.step)
      const dist = takeDist(take)
      return st && dist ? copy(st, dist).title : take.name
    },
    [copy],
  )
}
