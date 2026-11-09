// Wave Link + ReaPlugs path: effects list → [AI noise removal first] → add and set each plugin of the chain
// → hardware low cut → [listen check] → test.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Suggestion } from '../../types'
import { AiNoiseStep } from './AiNoiseStep'
import { ApplyAutomatically } from './ApplyAutomatically'
import { GuideStepper, type GuideStep } from './GuideStepper'
import { calloutsOf, hz, type StepAction } from './guideFormat'
import { useNrChoice, type NrChoice } from './nrChoice'
import { WaveLinkEffects } from './replicas/WaveLinkEffects'
import { StepNote, StepText } from './StepText'
import { TestStep } from './TestStep'
import { CompStep, EqStep, GateStep, ReaFirStep } from './WaveLinkPanels'
import { effectiveChoice, guideChain, offEffects, waveLinkSteps, type WaveLinkStep } from './waveLinkSteps'

function title(t: TFunction, s: Suggestion, x: WaveLinkStep): string {
  switch (x.kind) {
    case 'add':
      return t('guide.wl.add.title', { plugin: x.plugin })
    case 'reafir':
      return t(`guide.wl.reafir.${x.phase}.title`)
    case 'eq':
      return t('guide.wl.eq.title', { n: (x.band ?? 0) + 1, total: s.eq.length })
    case 'test':
      return t('guide.test.title')
    default:
      return t(`guide.wl.${x.kind}.title`)
  }
}

interface BodyProps {
  s: Suggestion
  x: WaveLinkStep
  choice: NrChoice | null
  onChoose: (c: NrChoice) => void
}

function Body({ s, x, choice, onChoose }: BodyProps) {
  const { t } = useTranslation()
  const chain = guideChain(s, choice)
  const off = offEffects(s, choice)
  switch (x.kind) {
    case 'effects':
      return (
        <>
          <StepText
            lead={t('guide.wl.effects.lead')}
            actions={[{ text: t('guide.wl.effects.a1') }, { text: t('guide.wl.effects.a2') }, { text: t('guide.wl.effects.a3', { list: off.join(', ') }) }]}
            notes={s.deess && <StepNote>{t('guide.wl.effects.deess')}</StepNote>}
          />
          <WaveLinkEffects chain={chain} off={off} callouts={off.map((name) => ({ n: 3, target: `toggle-${name}` }))} />
        </>
      )
    case 'ai':
      return <AiNoiseStep choice={choice} onChoose={onChoose} />
    case 'add': {
      const p = { plugin: x.plugin, n: x.position, total: chain.length, order: chain.join(' → ') }
      const actions: StepAction[] = [
        { text: t('guide.wl.add.a1', p), target: 'addEffect' },
        { text: t('guide.wl.add.a2', p), target: `row-${x.plugin}` },
        { text: t('guide.wl.add.a3'), target: `settings-${x.plugin}` },
      ]
      return (
        <>
          <StepText
            lead={t('guide.wl.add.lead', p)}
            actions={actions}
          />
          <WaveLinkEffects chain={chain} off={off} highlight={x.plugin} callouts={calloutsOf(actions)} />
        </>
      )
    }
    case 'reafir':
      return <ReaFirStep phase={x.phase ?? 'setup'} />
    case 'eq':
      return <EqStep s={s} band={x.band ?? 0} />
    case 'eqFlat':
      return <StepText lead={t('guide.wl.eqFlat.lead')} actions={[]} />
    case 'comp':
      return <CompStep s={s} />
    case 'gate':
      return <GateStep s={s} />
    case 'lowcut':
      return (
        <>
          <StepText lead={t('guide.wl.lowcut.lead')} actions={[{ text: t('guide.wl.lowcut.a1'), target: 'lowcut' }, { text: t('guide.wl.lowcut.a2', { hz: hz(s.lowcut) }), target: 'lowcut' }]} />
          <WaveLinkEffects chain={chain} off={off} lowcut={s.lowcut} callouts={[{ n: 1, target: 'lowcut' }]} />
        </>
      )
    case 'listen':
      return <StepText lead={t('guide.wl.listen.lead')} actions={[]} />
    case 'test':
      return <TestStep />
  }
}

export function WaveLinkGuide({ s }: { s: Suggestion }) {
  const { t } = useTranslation()
  const [saved, setChoice] = useNrChoice()
  const choice = effectiveChoice(s, saved)
  const steps = useMemo(
    (): GuideStep[] =>
      waveLinkSteps(s, choice).map((x) => ({ id: x.id, title: title(t, s, x), body: <Body s={s} x={x} choice={choice} onChoose={setChoice} /> })),
    [s, t, choice, setChoice],
  )
  return (
    <div className="grid gap-4">
      <GuideStepper title={t('guide.host.option.wavelink.name')} steps={steps} />
      <ApplyAutomatically manualReaFir={guideChain(s, choice).includes('ReaFIR')} />
    </div>
  )
}
