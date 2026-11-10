import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { backupName, downloadPair, saveDirectly, type WlFileHandle } from './wlFiles'

type Direct = 'idle' | 'saved' | 'failed'

function SwapSteps({ backup }: { backup: string }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-1">
      <Typography variant="subtitle2" component="h3">{t('profiles.wl.download.swapTitle')}</Typography>
      <ol className="m-0 grid gap-1 pl-5">
        {(['s1', 's2', 's3'] as const).map((k) => (
          <Typography component="li" variant="body2" key={k}>{t(`profiles.wl.download.${k}`)}</Typography>
        ))}
      </ol>
      <Typography variant="body2" color="text.secondary">{t('profiles.wl.download.undo', { backup })}</Typography>
    </div>
  )
}

/** Step 3: one click downloads the new Settings.json and the dated backup, then the swap instructions. */
export function DownloadStep({ text, original, handle, onDone }: { text: string; original: string; handle: WlFileHandle | null; onDone?(): void }) {
  const { t } = useTranslation()
  const [backup, setBackup] = useState<string | null>(null)
  const [direct, setDirect] = useState<Direct>('idle')
  const download = (): void => {
    const now = new Date()
    downloadPair(text, original, now)
    setBackup(backupName(now))
    onDone?.()
  }
  const save = async (): Promise<void> => {
    const ok = await saveDirectly(handle!, text)
    setDirect(ok ? 'saved' : 'failed')
    if (ok) onDone?.()
  }
  return (
    <div className="grid gap-3">
      <Typography variant="body2">{t('profiles.wl.download.lead')}</Typography>
      <div className="flex flex-wrap gap-2">
        <Button variant="contained" onClick={download}>{t('profiles.wl.download.button')}</Button>
        {handle && (
          <Button variant="outlined" disabled={!backup || direct === 'saved'} onClick={() => void save()}>
            {t('profiles.wl.download.saveDirect')}
          </Button>
        )}
      </div>
      {handle && !backup && (
        <Typography variant="body2" color="text.secondary">{t('profiles.wl.download.saveDirectHint')}</Typography>
      )}
      {direct === 'saved' && <Alert severity="success">{t('profiles.wl.download.savedDirect')}</Alert>}
      {direct === 'failed' && <Alert severity="warning">{t('profiles.wl.download.directFailed')}</Alert>}
      {backup && <Alert severity="success">{t('profiles.wl.download.done', { backup })}</Alert>}
      {backup && <SwapSteps backup={backup} />}
    </div>
  )
}
