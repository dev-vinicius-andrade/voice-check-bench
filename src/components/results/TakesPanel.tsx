import { useEffect, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import { TakeRow } from './TakeRow'
import { useTakeGroups } from '../../store/hooks'

/** "Delete all" that needs a second click within 4 s (prototype clearAll). */
function useArmedDeleteAll(): [boolean, () => void] {
  const deleteAll = useBench((s) => s.deleteAll)
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const click = (): void => {
    window.clearTimeout(timer.current)
    if (!armed) {
      setArmed(true)
      timer.current = window.setTimeout(() => setArmed(false), 4000)
      return
    }
    setArmed(false)
    deleteAll()
  }
  return [armed, click]
}

export function TakesPanel() {
  const { t } = useTranslation()
  const groups = useTakeGroups()
  const storageAvailable = useBench((s) => s.storageAvailable)
  const newSession = useBench((s) => s.newSession)
  const startFreeTake = useBench((s) => s.startFreeTake)
  const [armed, deleteAll] = useArmedDeleteAll()
  const hasTakes = groups.some((g) => g.takes.length > 0)

  return (
    <Paper component="aside" aria-label={t('results.takes.title')} className="grid min-w-0 content-start gap-2.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <Typography variant="h6" component="h2">{t('results.takes.title')}</Typography>
        {hasTakes && (
          <Button size="small" variant="text" color="error" onClick={deleteAll}>
            {armed ? t('results.takes.deleteConfirm') : t('results.takes.deleteAll')}
          </Button>
        )}
      </div>
      <Typography variant="body2" color="text.secondary">
        {storageAvailable
          ? t('results.takes.hintAB')
          : t('results.takes.storageBlocked')}
      </Typography>
      {!hasTakes && <Typography variant="body2" color="text.secondary">{t('results.takes.none')}</Typography>}
      {groups.map((g) => (
        <div key={g.session} className="grid gap-1.5">
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mt: 1 }}>{g.label}</Typography>
          {g.takes.map((t) => <TakeRow key={t.id} take={t} />)}
        </div>
      ))}
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button variant="contained" onClick={newSession}>{t('results.takes.newSession')}</Button>
        <Button variant="outlined" onClick={startFreeTake}>{t('results.takes.freeTake')}</Button>
      </div>
    </Paper>
  )
}
