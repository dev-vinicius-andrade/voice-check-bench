import { useMemo } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useShallow } from 'zustand/react/shallow'
import { useBench } from '../../store/benchStore'
import type { Take } from '../../types'
import { beforeAfterPair, voiceBandSnr } from './roomNoise'

/** Below this SNR gain (dB) the effects did not really lower the room. */
const MIN_GAIN = 3

interface RowProps {
  label: string
  raw: number
  fx: number
  unit: string
  /** true when a higher value is better (SNR); false for the noise floor. */
  higherIsBetter: boolean
}

function Row({ label, raw, fx, unit, higherIsBetter }: RowProps) {
  const ok = Number.isFinite(raw) && Number.isFinite(fx)
  const d = fx - raw
  const color = !ok || Math.abs(d) < 1 ? 'text.secondary' : d > 0 === higherIsBetter ? 'success.main' : 'error.main'
  const f = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '—')
  return (
    <div className="contents">
      <Typography component="dt" variant="body2">{label}</Typography>
      <Typography component="dd" variant="body2" className="m-0 text-right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {f(raw)} → {f(fx)} {unit}{' '}
        {ok && (
          <Box component="span" sx={{ color, fontWeight: 700 }}>
            ({d > 0 ? '+' : ''}{d.toFixed(1)})
          </Box>
        )}
      </Typography>
    </div>
  )
}

/** Raw control vs processed take of A's session: SNR, voice-band SNR and noise floor, with a one-line verdict. */
export function BeforeAfterCard({ A }: { A: Take }) {
  const inputs = useBench(useShallow((s) => ({ takes: s.takes, session: s.session, fxDist: s.fxDist })))
  const pair = useMemo(() => beforeAfterPair(inputs.takes, A, inputs.session, inputs.fxDist), [inputs, A])
  if (!pair) return null
  const raw = pair.raw.analysis
  const fx = pair.fx.analysis
  const gain = fx.snr - raw.snr
  return (
    <Paper component="section" aria-label="Before and after" className="grid gap-2 px-3 py-2.5">
      <div>
        <Typography sx={{ fontWeight: 700 }}>Before / after</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {pair.raw.name} → {pair.fx.name}
        </Typography>
      </div>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
        <Row label="SNR" raw={raw.snr} fx={fx.snr} unit="dB" higherIsBetter />
        <Row label="Voice-band SNR" raw={voiceBandSnr(raw)} fx={voiceBandSnr(fx)} unit="dB" higherIsBetter />
        <Row label="Noise floor" raw={raw.noise} fx={fx.noise} unit="dBFS" higherIsBetter={false} />
      </dl>
      {gain >= MIN_GAIN ? (
        <Alert severity="success">Your effects lowered the room by {gain.toFixed(0)} dB</Alert>
      ) : (
        <Alert severity="warning">Noise reduction made little difference — check the ReaFIR profile</Alert>
      )}
    </Paper>
  )
}
