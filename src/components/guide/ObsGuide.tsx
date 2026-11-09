// OBS Studio path: the mic's Filters with built-in filters and values mapped from the suggestion (no replicas).
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Suggestion } from '../../types'
import { GuideStepper, type GuideStep } from './GuideStepper'
import { db, hz, ms, num, signedDb, type StepAction } from './guideFormat'
import { OBS_LOW_MID_HZ, OBS_MID_HIGH_HZ, obsValues } from './obsValues'
import { StepNote, StepText } from './StepText'
import { TestStep } from './TestStep'

export function ObsGuide({ s }: { s: Suggestion }) {
  const { t } = useTranslation()
  const steps = useMemo((): GuideStep[] => {
    const v = obsValues(s)
    const add = (name: string): StepAction => ({ text: t('guide.field.add', { name }) })
    const set = (field: string, value: string): StepAction => ({ text: t('guide.field.set', { field, value }) })
    const g = v.gate
    const gate: GuideStep =
      g.kind === 'expander'
        ? {
            id: 'expander',
            title: t('guide.obs.expander.title'),
            body: (
              <StepText
                lead={t('guide.obs.expander.lead')}
                actions={[add('Expander'), set('Ratio', `${num(g.ratio)}:1`), set('Threshold', db(g.threshold)), set('Attack', ms(g.attack)), set('Release', ms(g.release))]}
              />
            ),
          }
        : {
            id: 'gate',
            title: t('guide.obs.gate.title'),
            body: (
              <StepText
                lead={t('guide.obs.gate.lead')}
                actions={[
                  add('Noise Gate'),
                  set('Close Threshold', db(g.close)),
                  set('Open Threshold', db(g.open)),
                  set('Attack Time', ms(g.attack)),
                  set('Hold Time', ms(g.hold)),
                  set('Release Time', ms(g.release)),
                ]}
              />
            ),
          }
    return [
      {
        id: 'open',
        title: t('guide.obs.open.title'),
        body: <StepText lead={t('guide.obs.open.lead')} actions={[{ text: t('guide.obs.open.a1') }, { text: t('guide.obs.open.a2') }, { text: t('guide.obs.open.a3') }]} />,
      },
      ...(v.noiseSuppression
        ? [{
            id: 'noise',
            title: t('guide.obs.noise.title'),
            body: (
              <StepText
                lead={t('guide.obs.noise.lead')}
                actions={[add('Noise Suppression'), { text: t('guide.obs.noise.method') }]}
                notes={<StepNote>{t('guide.obs.noise.vst')}</StepNote>}
              />
            ),
          }]
        : []),
      gate,
      {
        id: 'eq',
        title: t('guide.obs.eq.title'),
        body: (
          <StepText
            lead={t('guide.obs.eq.lead', { low: hz(OBS_LOW_MID_HZ), high: hz(OBS_MID_HIGH_HZ) })}
            actions={[add('3-Band EQ'), set('Low', signedDb(v.eq3.low)), set('Mid', signedDb(v.eq3.mid)), set('High', signedDb(v.eq3.high))]}
            notes={<StepNote>{t(v.hasNotches ? 'guide.obs.eq.notches' : 'guide.obs.eq.vst')}</StepNote>}
          />
        ),
      },
      {
        id: 'comp',
        title: t('guide.obs.comp.title'),
        body: (
          <StepText
            lead={t('guide.obs.comp.lead')}
            actions={[
              add('Compressor'),
              set('Ratio', `${num(v.comp.ratio)}:1`),
              set('Threshold', db(v.comp.threshold)),
              set('Attack', ms(v.comp.attack)),
              set('Release', ms(v.comp.release)),
              set('Output Gain', signedDb(v.comp.output)),
            ]}
          />
        ),
      },
      {
        id: 'limiter',
        title: t('guide.obs.limiter.title'),
        body: <StepText lead={t('guide.obs.limiter.lead')} actions={[add('Limiter'), set('Threshold', db(v.limiter.threshold)), set('Release', ms(v.limiter.release))]} />,
      },
      { id: 'test', title: t('guide.test.title'), body: <TestStep /> },
    ]
  }, [s, t])
  return <GuideStepper title={t('guide.host.option.obs.name')} steps={steps} />
}
