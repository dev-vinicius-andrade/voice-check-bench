// ReaComp replica. Callout targets: threshold, preComp, attack, release, classicAttack, autoRelease, ratio, knee,
// detector, lowpass, highpass, rms, wet, dry, previewFilter, autoMakeup, aa, limit.
import Box from '@mui/material/Box'
import { useTranslation } from 'react-i18next'
import { Check, Group, Select } from './controls'
import { fmtDbField, fmtExact, fmtMsField, scalePos } from './fieldFormat'
import { ReplicaFrame } from './ReplicaFrame'
import { FieldRow, Meter, ParamRow, VStrip } from './strips'
import type { ReaCompPanelProps } from './types'

export const REACOMP_TITLE = 'ReaComp (ReaPlugs Edition)'
const WIDTH = 680

export function ReaCompPanel({ comp, callouts }: ReaCompPanelProps) {
  const { t } = useTranslation()
  const v = {
    threshold: fmtDbField(comp.threshold),
    ratio: fmtExact(comp.ratio, 1, 2),
    attack: fmtMsField(comp.attack),
    release: fmtMsField(comp.release),
    knee: fmtDbField(comp.knee),
    wet: fmtDbField(comp.wet),
  }
  const summary = [t('replicas.comp.values', { ...v, limit: t(comp.limit ? 'replicas.on' : 'replicas.off') })]
  return (
    <ReplicaFrame title={REACOMP_TITLE} width={WIDTH} summary={summary} callouts={callouts} testId="replica-reacomp">
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <VStrip label="Threshold" pos={scalePos(comp.threshold, -60, 0)} value={v.threshold} unit="dB" target="threshold" height={200} />
        <Box sx={{ display: 'grid', gap: 1, flex: 'none' }}>
          <Group>
            <ParamRow label="Pre-comp" pos={0} unit="ms" target="preComp" />
            <ParamRow label="Attack" pos={scalePos(comp.attack, 0, 200)} value={v.attack} unit="ms" target="attack" />
            <ParamRow label="Release" pos={scalePos(comp.release, 0, 1000)} value={v.release} unit="ms" target="release" />
            <Box sx={{ display: 'flex', gap: 2, my: 0.5 }}>
              <Check label="Classic attack" checked target="classicAttack" />
              <Check label="Auto release" checked={false} target="autoRelease" />
            </Box>
            <FieldRow label="Ratio" value={v.ratio} unit=":1" target="ratio" />
            <FieldRow label="Knee size" value={v.knee} unit="dB" target="knee" />
          </Group>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box component="span" sx={{ width: 96 }}>Detector input</Box>
            <Select value="" width={150} target="detector" />
          </Box>
          <FieldRow label="Lowpass" unit="Hz" target="lowpass" />
          <FieldRow label="Highpass" unit="Hz" target="highpass" />
          <FieldRow label="RMS size" unit="ms" target="rms" />
        </Box>
        <Meter height={250} />
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Group label="Output mix">
            <Box sx={{ display: 'flex', gap: 1 }}>
              <VStrip label="Wet" pos={scalePos(comp.wet, -24, 12)} value={v.wet} unit="dB" target="wet" height={120} />
              <VStrip label="Dry" pos={0} unit="dB" target="dry" height={120} />
            </Box>
          </Group>
          <Check label="Preview filter" checked={false} target="previewFilter" />
          <Check label="Auto make-up" checked={false} target="autoMakeup" />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            AA <Select value="" width={80} target="aa" />
          </Box>
          <Check label="Limit output" checked={comp.limit} target="limit" />
        </Box>
      </Box>
    </ReplicaFrame>
  )
}
