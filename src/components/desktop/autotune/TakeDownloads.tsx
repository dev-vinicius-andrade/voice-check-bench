import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useMsg } from '../../common/MsgText'
import { saveWav as realSaveWav, type SaveWav } from '../../../desktop/bridge'
import { useTakeDownload } from './useTakeDownload'

interface TakeDownloadsProps {
  before: Float32Array
  after: Float32Array
  /** bridge.saveWav (a fake in tests). */
  saveWav?: SaveWav
}

/** "Download" for each side: Before = the raw take, After = the tuned render, saved as WAV files in Downloads. */
export function TakeDownloads({ before, after, saveWav = realSaveWav }: TakeDownloadsProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  const d = useTakeDownload(saveWav)
  const s = d.state
  const busy = s.step === 'saving'
  return (
    <div className="grid gap-2" data-testid="autotune-downloads">
      <div className="flex flex-wrap gap-2">
        <Button variant="outlined" size="small" disabled={busy} onClick={() => void d.save('before', before)}>
          {t('desktop.autotune.ui.result.download.before')}
        </Button>
        <Button variant="outlined" size="small" disabled={busy} onClick={() => void d.save('after', after)}>
          {t('desktop.autotune.ui.result.download.after')}
        </Button>
      </div>
      {busy && <Typography variant="body2">{t('desktop.autotune.ui.result.download.saving')}</Typography>}
      {s.step === 'saved' && (
        <Alert severity="success" data-testid="autotune-download-saved" sx={{ overflowWrap: 'anywhere' }}>
          {t('desktop.autotune.ui.result.download.saved', { path: s.path })}
        </Alert>
      )}
      {s.step === 'error' && (
        <Alert severity="error" data-testid="autotune-download-error">
          {tm(s.msg)}
        </Alert>
      )}
    </div>
  )
}
