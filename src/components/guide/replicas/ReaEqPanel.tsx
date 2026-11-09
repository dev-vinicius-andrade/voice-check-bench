// ReaEQ replica. Callout targets: tab-<n> (1-based), enabled, type, logScale, frequency, gain, bandwidth,
// addBand, removeBand, resetDefaults, showTabs, showGrid, showPhase, curve (the graph).
import Box from '@mui/material/Box'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EqGraph } from './EqGraph'
import { Btn, Check, Field, HSlider, Select } from './controls'
import { fmtDbField, fmtExact, fmtHzField, noteName, scalePos } from './fieldFormat'
import { ReplicaFrame } from './ReplicaFrame'
import { RC } from './replicaStyle'
import { Spot } from './Spot'
import type { ReaEqPanelProps } from './types'

export const REAEQ_TITLE = 'ReaEQ (ReaPlugs Edition)'
const WIDTH = 640

function Row({ label, pos, value, target, extra }: { label: string; pos: number; value: string; target: string; extra?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 28 }}>
      <Box component="span" sx={{ width: 118, flex: 'none' }}>{label}</Box>
      <HSlider pos={pos} width={280} />
      <Field value={value} target={target} width={72} />
      <Box component="span" sx={{ color: RC.muted, minWidth: 36 }}>{extra}</Box>
    </Box>
  )
}

function Tabs({ count, active }: { count: number; active: number }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, borderBottom: `1px solid ${RC.line}`, my: 1 }}>
      {Array.from({ length: count }, (_, i) => (
        <Spot key={i} target={`tab-${i + 1}`}>
          <Box
            component="span"
            data-testid="eq-tab"
            data-selected={i === active}
            sx={{
              px: 1.5,
              py: 0.25,
              border: `1px solid ${i === active ? RC.primary : RC.line}`,
              borderBottom: 'none',
              borderRadius: '4px 4px 0 0',
              bgcolor: i === active ? RC.tint : RC.panel,
              color: i === active ? RC.ink : RC.muted,
              fontWeight: i === active ? 700 : 400,
            }}
          >
            {i + 1}
          </Box>
        </Spot>
      ))}
    </Box>
  )
}

export function ReaEqPanel({ eq, activeBand, callouts }: ReaEqPanelProps) {
  const { t } = useTranslation()
  const active = Math.min(Math.max(0, activeBand), Math.max(0, eq.length - 1))
  const band = eq[active]
  const summary = eq.length
    ? [
        ...eq.map((b, i) => t('replicas.eq.band', { n: i + 1, type: b.type, freq: fmtHzField(b.freq), gain: fmtDbField(b.gain), bw: fmtExact(b.bw, 1, 2) })),
        t('replicas.eq.selected', { n: active + 1 }),
      ]
    : [t('replicas.eq.none')]
  return (
    <ReplicaFrame title={REAEQ_TITLE} width={WIDTH} summary={summary} callouts={callouts} testId="replica-reaeq">
      <Spot target="curve" block>
        <EqGraph bands={eq} active={active} />
      </Spot>
      <Tabs count={eq.length} active={active} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
        <Check label="Enabled" checked={!!band} target="enabled" />
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          Type: <Select value={band?.type ?? ''} width={130} target="type" />
        </Box>
        <Check label="Log-scale automated frequencies" checked target="logScale" />
      </Box>
      <Row label="Frequency (Hz):" pos={band ? scalePos(band.freq, 20, 24000, true) : 0} value={band ? fmtHzField(band.freq) : ''} target="frequency" extra={band ? noteName(band.freq) : ''} />
      <Row label="Gain (dB):" pos={band ? scalePos(band.gain, -24, 24) : 0.5} value={band ? fmtDbField(band.gain) : ''} target="gain" />
      <Row label="Bandwidth (oct):" pos={band ? scalePos(band.bw, 0.01, 4) : 0} value={band ? fmtExact(band.bw, 1, 2) : ''} target="bandwidth" />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.25 }}>
        <Btn label="Add band" target="addBand" />
        <Btn label="Remove band" target="removeBand" />
        <Btn label="Reset defaults" target="resetDefaults" />
        <Box component="span" sx={{ flex: 1 }} />
        <Check label="Show tabs" checked target="showTabs" />
        <Check label="Show grid" checked target="showGrid" />
        <Check label="Show phase" checked={false} target="showPhase" />
      </Box>
    </ReplicaFrame>
  )
}
