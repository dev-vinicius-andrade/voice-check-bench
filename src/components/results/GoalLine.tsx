import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import { GoalPicker } from '../common/GoalPicker'
import { MsgText } from '../common/MsgText'
import { perceivedNotes } from '../../plain/perceived'
import type { Analysis } from '../../types'

/** "Your goal: Warm and deep · you hear: nasal" + "Change goal" (dialog; results re-score from the store, no re-recording). */
export function GoalLine({ analysis }: { analysis?: Analysis | null }) {
  const { t } = useTranslation()
  const titleId = useId()
  const goal = useBench((s) => s.goal)
  const [open, setOpen] = useState(false)
  const style = t(`wizard.goal.style.${goal.style}.name`)
  const hear = goal.perceived.map((p) => t(`wizard.goal.perceived.${p}`)).join(', ')
  const notes = analysis ? perceivedNotes(analysis, goal) : []
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Typography variant="body2" color="text.secondary">
        {hear ? t('results.goal.lineHear', { style, hear }) : t('results.goal.line', { style })}
      </Typography>
      <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
        {t('results.goal.change')}
      </Button>
      {notes.length > 0 && (
        <ul className="m-0 grid w-full gap-1 pl-5">
          {notes.map((n) => (
            <Typography component="li" variant="body2" key={n.key}>
              <MsgText msg={n} />
            </Typography>
          ))}
        </ul>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby={titleId} fullWidth maxWidth="sm">
        <DialogTitle id={titleId}>{t('results.goal.dialogTitle')}</DialogTitle>
        <DialogContent>
          <GoalPicker />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setOpen(false)}>
            {t('results.goal.done')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
