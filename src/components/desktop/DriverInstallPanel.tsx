// VB-Cable detection panel: checks whether VB-Audio Virtual Cable is installed
// by querying WASAPI audio endpoints. If not found, shows download instructions.
// If found, confirms readiness for virtual microphone use.
import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { isVbCableInstalled } from '../../desktop/bridge'

type VbCableState = 'checking' | 'installed' | 'not-installed' | 'error'

const VB_CABLE_DOWNLOAD_URL = 'https://vb-audio.com/Cable/'

export function DriverInstallPanel() {
 const { t } = useTranslation()
 const [state, setState] = useState<VbCableState>('checking')
 const [message, setMessage] = useState('')

 const checkStatus = useCallback(async () => {
 setState('checking')
 setMessage('')
 try {
 const installed = await isVbCableInstalled()
 setState(installed ? 'installed' : 'not-installed')
 } catch (e) {
 setState('error')
 setMessage(String(e))
 }
 }, [])

 useEffect(() => {
 void checkStatus()
 }, [checkStatus])

 return (
 <Paper component="section" className="grid gap-4 p-6" elevation={0} variant="outlined">
 <div className="grid gap-1">
 <Typography variant="h6" component="h2">
 {t('desktop.driver.title')}
 </Typography>
 <Typography variant="body2" color="text.secondary">
 {t('desktop.driver.description')}
 </Typography>
 </div>

 {state === 'checking' && (
 <div className="flex items-center gap-3 py-2">
 <CircularProgress size={20} />
 <Typography variant="body2" color="text.secondary">
 {t('desktop.driver.checking')}
 </Typography>
 </div>
 )}

 {state === 'not-installed' && (
 <div className="grid gap-3">
 <Alert severity="info" variant="outlined">
 {t('desktop.driver.vbCableNotInstalled')}
 </Alert>
 <div className="grid gap-2">
 <Typography variant="body2">
 {t('desktop.driver.vbCableInstructions')}
 </Typography>
 <ol className="ml-5 grid gap-1 text-sm">
 <li>{t('desktop.driver.vbCableStep1')}</li>
 <li>{t('desktop.driver.vbCableStep2')}</li>
 <li>{t('desktop.driver.vbCableStep3')}</li>
 <li>{t('desktop.driver.vbCableStep4')}</li>
 </ol>
 <Button
 variant="contained"
 component={Link}
 href={VB_CABLE_DOWNLOAD_URL}
 target="_blank"
 rel="noopener noreferrer"
 sx={{ alignSelf: 'start' }}
 >
 {t('desktop.driver.downloadVbCable')}
 </Button>
 <Button variant="text" size="small" onClick={() => void checkStatus()} sx={{ alignSelf: 'start' }}>
 {t('desktop.driver.recheck')}
 </Button>
 </div>
 </div>
 )}

 {state === 'installed' && (
 <div className="grid gap-3">
 <Alert severity="success" variant="outlined">
 {t('desktop.driver.vbCableInstalled')}
 </Alert>
 <Typography variant="caption" color="text.secondary">
 {t('desktop.driver.vbCableReadyHint')}
 </Typography>
 </div>
 )}

 {state === 'error' && (
 <Alert severity="error" variant="outlined">
 <Typography variant="body2">{message || t('desktop.driver.error')}</Typography>
 <Button variant="text" size="small" onClick={() => void checkStatus()} sx={{ mt: 1, p: 0 }}>
 {t('desktop.driver.recheck')}
 </Button>
 </Alert>
 )}
 </Paper>
 )
}