import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { WlApplyResult } from '../../wavelink/types'
import { changeText } from './wlPlan'

/** Step 2: what will change, and which effects must be added in Wave Link first (those parts are skipped). */
export function PreviewStep({ result }: { result: WlApplyResult }) {
  const { t } = useTranslation()
  const changes = result.changes.filter((c) => c.kind !== 'missing')
  return (
    <div className="grid gap-3">
      <Typography variant="body2">{t('profiles.wl.preview.lead')}</Typography>
      {changes.length === 0 ? (
        <Alert severity="info">{t('profiles.wl.preview.none')}</Alert>
      ) : (
        <ul className="m-0 grid gap-1 pl-5" aria-label={t('profiles.wl.preview.listLabel')}>
          {changes.map((c, i) => (
            <Typography component="li" variant="body2" key={`${c.plugin}-${c.field}-${i}`}>
              {changeText(t, c)}
            </Typography>
          ))}
        </ul>
      )}
      {result.missing.length > 0 && (
        <Alert severity="warning">
          <div className="grid gap-1">
            {result.missing.map((m) => (
              <span key={m}>{t('profiles.wl.preview.missing', { plugin: m })}</span>
            ))}
            <span>{t('profiles.wl.preview.missingRest')}</span>
          </div>
        </Alert>
      )}
    </div>
  )
}
