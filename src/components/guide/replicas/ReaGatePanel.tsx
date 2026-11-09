// ReaGate replica (same family as ReaComp). Callout targets: threshold, attack, hold, release, preOpen, hysteresis,
// detector, lowpass, highpass, wet, dry, noise.
import Box from '@mui/material/Box'
import { useTranslation } from 'react-i18next'
import { Group, Select } from './controls'
import { fmtDbField, fmtMsField, scalePos } from './fieldFormat'
import { ReplicaFrame } from './ReplicaFrame'
import { FieldRow, Meter, ParamRow, VStrip } from './strips'
import type { ReaGatePanelProps } from './types'

export const REAGATE_TITLE = 'ReaGate (ReaPlugs Edition)'
const WIDTH = 720

export function ReaGatePanel({ gate, callouts }: ReaGatePanelProps) {
  const { t } = useTranslation()
  const v = {
    threshold: fmtDbField(gate.threshold),
    attack: fmtMsField(gate.attack),
    hold: fmtMsField(gate.hold),
    release: fmtMsField(gate.release),
    hysteresis: fmtDbField(gate.hysteresis),
    wet: fmtDbField(gate.wet),
    dry: fmtDbField(gate.dry),
  }
  return (
    <ReplicaFrame title={REAGATE_TITLE} width={WIDTH} summary={[t('replicas.gate.values', v)]} callouts={callouts} testId="replica-reagate">
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <VStrip label="Threshold" pos={scalePos(gate.threshold, -90, 0)} value={v.threshold} unit="dB" target="threshold" height={200} />
        <Box sx={{ display: 'grid', gap: 1, flex: 'none' }}>
          <Group>
            <ParamRow label="Attack" pos={scalePos(gate.attack, 0, 100)} value={v.attack} unit="ms" target="attack" />
            <ParamRow label="Hold" pos={scalePos(gate.hold, 0, 1000)} value={v.hold} unit="ms" target="hold" />
            <ParamRow label="Release" pos={scalePos(gate.release, 0, 1000)} value={v.release} unit="ms" target="release" />
            <ParamRow label="Pre-open" pos={0} unit="ms" target="preOpen" />
            <FieldRow label="Hysteresis" value={v.hysteresis} unit="dB" target="hysteresis" />
          </Group>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box component="span" sx={{ width: 96 }}>Detector input</Box>
            <Select value="" width={150} target="detector" />
          </Box>
          <FieldRow label="Lowpass" unit="Hz" target="lowpass" />
          <FieldRow label="Highpass" unit="Hz" target="highpass" />
        </Box>
        <Meter height={250} />
        <Group label="Output mix">
          <Box sx={{ display: 'flex', gap: 1 }}>
            <VStrip label="Wet" pos={scalePos(gate.wet, -60, 12)} value={v.wet} unit="dB" target="wet" height={150} />
            <VStrip label="Dry" pos={scalePos(gate.dry, -60, 12)} value={v.dry} unit="dB" target="dry" height={150} />
            <VStrip label="Noise" pos={0} unit="dB" target="noise" height={150} />
          </Box>
        </Group>
      </Box>
    </ReplicaFrame>
  )
}
