import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { WAVELINK_SETTINGS_PATH } from '../../wavelink/types'
import { Code } from '../pages/PageLayout'
import type { WaveLinkFileState } from './useWaveLinkFile'
import { canPickDirectly, pickDirectly } from './wlFiles'

function PathRow() {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(WAVELINK_SETTINGS_PATH)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Code>{WAVELINK_SETTINGS_PATH}</Code>
        <Button size="small" variant="outlined" onClick={() => void copy()}>
          {copied ? t('profiles.wl.upload.copied') : t('profiles.wl.upload.copy')}
        </Button>
      </div>
      <Typography variant="body2" color="text.secondary">{t('profiles.wl.upload.paste')}</Typography>
    </div>
  )
}

/** Step 1: explain where the file is, take it from a file input (or the direct picker), pick the mic input. */
export function UploadStep({ wl }: { wl: WaveLinkFileState }) {
  const { t } = useTranslation()
  const direct = canPickDirectly()
  const pick = async (): Promise<void> => {
    const r = await pickDirectly()
    if (r) wl.load(r.text, r.handle)
  }
  return (
    <div className="grid gap-3">
      <Typography variant="body2">{t('profiles.wl.upload.lead')}</Typography>
      <PathRow />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="contained" component="label">
          {t('profiles.wl.upload.choose')}
          <input
            hidden
            type="file"
            accept=".json,application/json"
            aria-label={t('profiles.wl.upload.choose')}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void wl.loadFile(f)
              e.target.value = ''
            }}
          />
        </Button>
        {direct && (
          <Button variant="outlined" onClick={() => void pick()}>{t('profiles.wl.upload.pickDirect')}</Button>
        )}
      </div>
      {wl.error && <Alert severity="error">{t(`profiles.wl.upload.error.${wl.error}`)}</Alert>}
      {wl.file && (
        <Alert severity="success">{t('profiles.wl.upload.ok', { count: wl.file.inputs.length })}</Alert>
      )}
      {wl.file && wl.file.inputs.length > 1 && (
        <TextField
          select
          size="small"
          label={t('profiles.wl.upload.input')}
          value={wl.inputKey}
          onChange={(e) => wl.setInputKey(e.target.value)}
        >
          {wl.file.inputs.map((i) => (
            <MenuItem key={i.key} value={i.key}>{i.label}</MenuItem>
          ))}
        </TextField>
      )}
    </div>
  )
}
