// "Show me how" panels for the next actions: mic placement and input volume (gain).
import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtCm } from '../../i18n/format'
import { FIST_CM } from '../../plain/actions'
import { distanceCm, everydayDistance } from '../../plain/distances'
import type { MicProfile } from '../../types'
import { useMsg } from '../common/MsgText'
import { Term } from '../common/Term'

const placementKey = (m: MicProfile): string =>
  m.pattern === 'cardioid' || m.pattern === 'supercardioid' ? m.pattern : 'other'
const addressKey = (m: MicProfile): string => (m.address === 'end' || m.address === 'side' ? m.address : 'unknown')

function Panel({ children }: { children: ReactNode }) {
  return (
    <Box className="mt-2 grid gap-1 py-1 pl-3" sx={{ borderLeft: 3, borderColor: 'primary.main' }}>
      {children}
    </Box>
  )
}

/** Where to point the mic, where to speak into it, and how far to stay (everyday distance + number). */
export function PlacementHow({ mic, bestDist }: { mic: MicProfile; bestDist: string | null | undefined }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const dist = bestDist ?? `${FIST_CM} cm`
  const cm = distanceCm(dist)
  const params = { everyday: tm(everydayDistance(dist)), dist: cm === null ? dist : fmtCm(cm) }
  return (
    <Panel>
      <Typography variant="body2">{t(`plain.action.placement.${placementKey(mic)}`)}.</Typography>
      <Typography variant="body2">{t(`plain.action.speakInto.${addressKey(mic)}`)}.</Typography>
      <Typography variant="body2">
        {bestDist ? t('results.how.placement.distanceKnown', params) : t('results.how.placement.distanceDefault', params)}
      </Typography>
    </Panel>
  )
}

/** What gain is, in plain words, and where to change it. */
export function GainHow() {
  const { t } = useTranslation()
  return (
    <Panel>
      <Typography variant="body2">
        <Term id="gain">{t('results.how.gain.term')}</Term> {t('results.how.gain.what')}
      </Typography>
      <Typography variant="body2">{t('results.how.gain.where')}</Typography>
      <Typography variant="body2">{t('results.how.gain.steps')}</Typography>
    </Panel>
  )
}
