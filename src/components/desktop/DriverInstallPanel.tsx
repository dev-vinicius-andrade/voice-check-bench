// Driver installation panel: lets users install/uninstall the VCB virtual audio capture driver
// directly from the app. Calls the Tauri backend commands which use pnputil under the hood.
// Requires the app to be running as Administrator for install/uninstall to succeed.
import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import {
 isVirtualAudioDriverInstalled,
 installVirtualAudioDriver,
 uninstallVirtualAudioDriver,
 type DriverInstallResult,
} from '../../desktop/bridge'

type DriverState = 'checking' | 'installed' | 'not-installed' | 'installing' | 'uninstalling' | 'error'

export function DriverInstallPanel() {
 const { t } = useTranslation()
 const [state, setState] = useState<DriverState>('checking')
 const [message, setMessage] = useState('')

 const checkStatus = useCallback(async () => {
 setState('checking')
 try {
 const installed = await isVirtualAudioDriverInstalled()
 setState(installed ? 'installed' : 'not-installed')
 setMessage('')
 } catch (e) {
 setState('error')
 setMessage(String(e))
 }
 }, [])

 useEffect(() => {
 void checkStatus()
 }, [checkStatus])

 const handleInstall = async () => {
 setState('installing')
 setMessage('')
 try {
 const result: DriverInstallResult = await installVirtualAudioDriver()
 if (result.success) {
 setState('installed')
 setMessage(result.message)
 } else {
 setState('error')
 setMessage(result.message)
 }
 } catch (e) {
 setState('error')
 setMessage(String(e))
 }
 }

 const handleUninstall = async () => {
 setState('uninstalling')
 setMessage('')
 try {
 const result: DriverInstallResult = await uninstallVirtualAudioDriver()
 if (result.success) {
 setState('not-installed')
 setMessage(result.message)
 } else {
 setState('error')
 setMessage(result.message)
 }
 } catch (e) {
 setState('error')
 setMessage(String(e))
 }
 }

 const busy = state === 'checking' || state === 'installing' || state === 'uninstalling'

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
 {t('desktop.driver.notInstalled')}
 </Alert>
 <Button
 variant="contained"
 onClick={() => void handleInstall()}
 disabled={busy}
 sx={{ alignSelf: 'start' }}
 >
 {t('desktop.driver.install')}
 </Button>
 </div>
 )}

 {state === 'installed' && (
 <div className="grid gap-3">
 <Alert severity="success" variant="outlined">
 {t('desktop.driver.installed')}
 </Alert>
 <Button
 variant="outlined"
 color="error"
 onClick={() => void handleUninstall()}
 disabled={busy}
 sx={{ alignSelf: 'start' }}
 >
 {t('desktop.driver.uninstall')}
 </Button>
 </div>
 )}

 {(state === 'installing' || state === 'uninstalling') && (
 <div className="flex items-center gap-3 py-2">
 <CircularProgress size={20} />
 <Typography variant="body2" color="text.secondary">
 {state === 'installing'
 ? t('desktop.driver.installing')
 : t('desktop.driver.uninstalling')}
 </Typography>
 </div>
 )}

 {state === 'error' && (
 <Alert severity="error" variant="outlined">
 <Typography variant="body2">{message || t('desktop.driver.error')}</Typography>
 <Typography component="span" variant="caption" sx={{ display: 'block', mt: 1 }}>
 {t('desktop.driver.adminHint')}
 </Typography>
 </Alert>
 )}

 {message && state !== 'error' && state !== 'checking' && (
 <Typography variant="caption" color="text.secondary">
 {message}
 </Typography>
 )}
 </Paper>
 )
}