import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import { useTranslation } from 'react-i18next'
import { checkForUpdate, type CheckForUpdate, type UpdateProgress } from '../../desktop/updater'
import { useUpdateNotice } from './useUpdateNotice'

interface Props {
  /** Injectable for tests; defaults to the real feed check. */
  check?: CheckForUpdate
  delayMs?: number
}

const fraction = (p: UpdateProgress | null): number | null =>
  p && p.total && p.total > 0 ? Math.min(1, p.downloaded / p.total) : null

/** Desktop app only: offers a newer version from the update feed once per start. */
export function UpdateNotice({ check = checkForUpdate, delayMs = 3000 }: Props) {
  const { t } = useTranslation()
  const { state, install, later } = useUpdateNotice(check, delayMs)
  if (state.phase === 'idle') return null
  const version = state.update.version
  const done = state.phase === 'installing' ? fraction(state.progress) : null

  return (
    <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
      {state.phase === 'installing' ? (
        <Alert severity="info" variant="filled" sx={{ width: '100%', minWidth: 280 }}>
          {done === null
            ? t('updater.installing', { version })
            : t('updater.installingProgress', { version, fraction: done })}
          <Box className="mt-2">
            <LinearProgress
              color="inherit"
              variant={done === null ? 'indeterminate' : 'determinate'}
              value={done === null ? undefined : done * 100}
              aria-label={t('updater.progressLabel')}
            />
          </Box>
        </Alert>
      ) : (
        <Alert
          severity={state.phase === 'failed' ? 'error' : 'info'}
          variant="filled"
          sx={{ width: '100%' }}
          action={
            <>
              <Button color="inherit" size="small" onClick={install}>
                {state.phase === 'failed' ? t('updater.retry') : t('updater.install')}
              </Button>
              <Button color="inherit" size="small" onClick={later}>
                {t('updater.later')}
              </Button>
            </>
          }
        >
          {state.phase === 'failed' ? t('updater.failed', { version }) : t('updater.available', { version })}
        </Alert>
      )}
    </Snackbar>
  )
}
