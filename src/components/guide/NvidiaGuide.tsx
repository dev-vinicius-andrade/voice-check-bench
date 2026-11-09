// NVIDIA Broadcast path: install, switch on Noise Removal, use its virtual mic in the apps.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GuideStepper, type GuideStep } from './GuideStepper'
import { StepText } from './StepText'
import { TestStep } from './TestStep'

const PARTS: Record<'install' | 'enable' | 'use', readonly string[]> = {
  install: ['a1', 'a2'],
  enable: ['a1', 'a2', 'a3'],
  use: ['a1', 'a2'],
}

export function NvidiaGuide() {
  const { t } = useTranslation()
  const steps = useMemo(
    (): GuideStep[] => [
      ...(Object.keys(PARTS) as (keyof typeof PARTS)[]).map((id) => ({
        id,
        title: t(`guide.nvidia.${id}.title`),
        body: <StepText lead={t(`guide.nvidia.${id}.lead`)} actions={PARTS[id].map((a) => ({ text: t(`guide.nvidia.${id}.${a}`) }))} />,
      })),
      { id: 'test', title: t('guide.test.title'), body: <TestStep /> },
    ],
    [t],
  )
  return <GuideStepper title={t('guide.host.option.nvidia.name')} steps={steps} />
}
