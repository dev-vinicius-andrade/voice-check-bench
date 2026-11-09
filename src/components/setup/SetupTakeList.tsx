import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useShallow } from 'zustand/react/shallow'
import { DEV_NAME, STEPS, fillDistance } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { useFxDist } from '../../store/hooks'
import type { DeviceKind } from '../../types'

/** The four guided takes and the input each one uses. */
export function SetupTakeList() {
  const fxDist = useFxDist()
  const labels = useBench(
    useShallow((s): Record<DeviceKind, string> => {
      const label = (kind: DeviceKind) => s.devices.find((d) => d.deviceId === s.deviceChoice[kind])?.label ?? DEV_NAME[kind]
      return { raw: label('raw'), fx: label('fx') }
    }),
  )
  return (
    <ol className="m-0 grid list-none gap-2 p-0">
      {STEPS.map((st, i) => (
        <Paper component="li" key={st.key} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3 px-3 py-2.5">
          <Box
            aria-hidden="true"
            sx={{
              width: 26,
              height: 26,
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              fontWeight: 700,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
            }}
          >
            {i + 1}
          </Box>
          <div className="min-w-0">
            <Typography sx={{ fontWeight: 700 }}>{fillDistance(st.title, fxDist)}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {st.dev === 'raw' ? 'Raw mic, no effects. Input: ' : 'Through your effects. Input: '}
              {labels[st.dev]}
            </Typography>
          </div>
        </Paper>
      ))}
    </ol>
  )
}
