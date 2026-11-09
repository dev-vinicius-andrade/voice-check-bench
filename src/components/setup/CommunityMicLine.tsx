import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useCommunityMic } from '../../community/useCommunity'
import { fmtDb } from '../../i18n/format'

/** One muted line under the mic card when the community has reports for this model. */
export function CommunityMicLine({ model }: { model: string }) {
  const { t } = useTranslation()
  const m = useCommunityMic(model)
  if (!m) return null
  const dist = m.bestDistance[0]?.dist
  const parts = [
    t('wizard.mic.community', { count: m.reports }),
    t('wizard.mic.communitySnr', { snr: fmtDb(m.rawSnr.median, 0, false) }),
    ...(dist ? [t('wizard.mic.communityDist', { dist })] : []),
  ]
  return (
    <Typography variant="body2" color="text.secondary">
      {parts.join(' · ')}
    </Typography>
  )
}
