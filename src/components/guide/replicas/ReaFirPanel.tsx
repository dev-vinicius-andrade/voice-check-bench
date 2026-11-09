// ReaFIR replica. Callout targets: curve, mode, fftSize, editMode, buildProfile.
import Box from '@mui/material/Box'
import { keyframes } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Select } from './controls'
import { FirGraph } from './FirGraph'
import { ReplicaFrame } from './ReplicaFrame'
import { RC } from './replicaStyle'
import { Spot } from './Spot'
import type { ReaFirPanelProps } from './types'

export const REAFIR_TITLE = 'ReaFIR (ReaPlugs Edition)'
const WIDTH = 640
const PROFILE_LABEL = 'Automatically build noise profile (enable during silence)'

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
`

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      {label}
      {children}
    </Box>
  )
}

export function ReaFirPanel({ phase, callouts }: ReaFirPanelProps) {
  const { t } = useTranslation()
  const setup = phase === 'setup'
  return (
    <ReplicaFrame title={REAFIR_TITLE} width={WIDTH} summary={[t(`replicas.fir.${phase}`)]} callouts={callouts} testId="replica-reafir">
      <Spot target="curve" block>
        <FirGraph phase={phase} />
      </Spot>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mt: 1.25 }}>
        <Labeled label="Mode:">
          <Select value="Subtract" width={120} target="mode" highlight={setup} />
        </Labeled>
        <Labeled label="FFT size:">
          <Select value="4096" width={80} target="fftSize" highlight={setup} />
        </Labeled>
        <Labeled label="Edit mode:">
          <Select value="" width={90} target="editMode" />
        </Labeled>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mt: 1.25 }}>
        <Check label={PROFILE_LABEL} checked={phase === 'profile'} target="buildProfile" />
        {phase === 'profile' && (
          <Box
            component="span"
            data-testid="fir-silent-hint"
            sx={{
              px: 1,
              py: 0.25,
              borderRadius: 999,
              bgcolor: RC.tint,
              color: RC.primary,
              fontWeight: 700,
              animation: `${pulse} 1.2s ease-in-out infinite`,
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          >
            {t('replicas.fir.stay')}
          </Box>
        )}
      </Box>
    </ReplicaFrame>
  )
}
