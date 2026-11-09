import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import { useBench } from '../../store/benchStore'
import { useMsg } from '../common/MsgText'

/** Global status line: errors stay until dismissed, other messages hide after 6 s. */
export function StatusSnackbar() {
  const status = useBench((s) => s.status)
  const clearStatus = useBench((s) => s.clearStatus)
  const tm = useMsg()
  const text = status ? tm(status.msg) : ''
  return (
    <Snackbar
      key={text}
      open={status !== null}
      autoHideDuration={status?.error ? null : 6000}
      onClose={(_, reason) => {
        if (reason !== 'clickaway') clearStatus()
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity={status?.error ? 'error' : 'info'} variant="filled" onClose={clearStatus} sx={{ width: '100%' }}>
        {text}
      </Alert>
    </Snackbar>
  )
}
