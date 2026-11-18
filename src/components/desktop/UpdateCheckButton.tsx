import { useState } from 'react'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { requestUpdateCheck, type ManualUpdateCheck } from '../../desktop/updater'

/** "Check for updates": asks the feed now. A found update shows in the update notice; none found is said here. */
export function UpdateCheckButton({ request = requestUpdateCheck }: { request?: ManualUpdateCheck }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'idle' | 'checking' | 'none'>('idle')
  const onClick = () => {
    setStatus('checking')
    void request().then((found) => setStatus(found ? 'idle' : 'none'))
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="small" variant="outlined" disabled={status === 'checking'} onClick={onClick}>
        {status === 'checking' ? t('updater.checking') : t('updater.check')}
      </Button>
      {status === 'none' && (
        <Typography variant="caption" color="text.secondary" role="status">
          {t('updater.none')}
        </Typography>
      )}
    </div>
  )
}
