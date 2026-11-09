// Discord / Teams / Zoom only: what to switch on or off in the call app + the free physical actions from the results.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Action } from '../../plain/types'
import type { Analysis, Suggestion } from '../../types'
import { useMsg } from '../common/MsgText'
import { usePlainResults } from '../results/usePlainResults'
import { GuideStepper, type GuideStep } from './GuideStepper'
import { StepText } from './StepText'
import { TestStep } from './TestStep'

/** Free actions people can do with their hands (the "ready-made settings" ones need an effects app). */
const freeActions = (actions: readonly Action[]): Action[] => actions.filter((x) => x.cost === 'free' && x.how !== 'settings')

export function AppsGuide({ s, a }: { s: Suggestion; a: Analysis }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const { actions } = usePlainResults(s.base, a)
  const steps = useMemo((): GuideStep[] => {
    const free = freeActions(actions)
    const lines = (area: string, keys: string[]) => keys.map((k) => ({ text: t(`guide.apps.${area}.${k}`) }))
    return [
      { id: 'noise', title: t('guide.apps.noise.title'), body: <StepText lead={t('guide.apps.noise.lead')} actions={lines('noise', ['discord', 'teams', 'zoom'])} /> },
      { id: 'echo', title: t('guide.apps.echo.title'), body: <StepText lead={t('guide.apps.echo.lead')} actions={lines('echo', ['discord'])} /> },
      {
        id: 'gain',
        title: t('guide.apps.gain.title'),
        body: <StepText lead={t(s.gainHint ? 'guide.apps.gain.fix' : 'guide.apps.gain.ok')} actions={lines('gain', ['discord', 'zoom'])} />,
      },
      {
        id: 'free',
        title: t('guide.apps.free.title'),
        body: (
          <StepText
            lead={t(free.length ? 'guide.apps.free.lead' : 'guide.apps.free.none')}
            actions={free.map((x) => ({ text: tm(x.text) }))}
          />
        ),
      },
      { id: 'test', title: t('guide.test.title'), body: <TestStep /> },
    ]
  }, [actions, s.gainHint, t, tm])
  return <GuideStepper title={t('guide.host.option.apps.name')} steps={steps} />
}
