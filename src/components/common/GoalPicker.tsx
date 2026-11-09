import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Typography from '@mui/material/Typography'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import type { PerceivedIssue, VoiceStyle } from '../../types'
import { PERCEIVED, STYLES } from './goalTarget'
import { StyleSketch } from './StyleSketch'

function StyleOption({ style, checked, idBase }: { style: VoiceStyle; checked: boolean; idBase: string }) {
  const { t } = useTranslation()
  const id = `${idBase}-${style}`
  return (
    <Paper
      component="label"
      variant="outlined"
      className="flex cursor-pointer items-start gap-2 p-3"
      sx={{ borderColor: checked ? 'primary.main' : 'divider', borderWidth: checked ? 2 : 1, '&:focus-within': { outline: 2, outlineColor: 'primary.main' } }}
    >
      <Radio value={style} size="small" sx={{ p: 0.5 }} slotProps={{ input: { 'aria-labelledby': `${id}-name`, 'aria-describedby': `${id}-desc` } }} />
      <div className="grid min-w-0 gap-1">
        <Typography id={`${id}-name`} sx={{ fontWeight: 700 }}>{t(`wizard.goal.style.${style}.name`)}</Typography>
        <Typography id={`${id}-desc`} variant="body2" color="text.secondary">
          {t(`wizard.goal.style.${style}.desc`)}
        </Typography>
        <StyleSketch style={style} />
      </div>
    </Paper>
  )
}

/** "What do you want your voice to sound like?" style cards + optional "what you hear" chips; edits the stored goal. */
export function GoalPicker() {
  const { t } = useTranslation()
  const headId = useId()
  const hearId = useId()
  const goal = useBench((s) => s.goal)
  const setGoal = useBench((s) => s.setGoal)
  const toggle = (p: PerceivedIssue): void =>
    setGoal({ perceived: goal.perceived.includes(p) ? goal.perceived.filter((x) => x !== p) : [...goal.perceived, p] })

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Typography id={headId} sx={{ fontWeight: 700 }}>{t('wizard.goal.title')}</Typography>
        <RadioGroup
          aria-labelledby={headId}
          value={goal.style}
          onChange={(_e, v) => setGoal({ style: STYLES.find((s) => s === v) ?? goal.style })}
          className="grid gap-2 sm:grid-cols-2"
        >
          {STYLES.map((s) => <StyleOption key={s} style={s} checked={goal.style === s} idBase={headId} />)}
        </RadioGroup>
      </div>
      <div className="grid gap-2">
        <Typography id={hearId} sx={{ fontWeight: 700 }}>{t('wizard.goal.hearTitle')}</Typography>
        <div role="group" aria-labelledby={hearId} className="flex flex-wrap gap-2">
          {PERCEIVED.map((p) => {
            const on = goal.perceived.includes(p)
            return (
              <Chip
                key={p}
                label={t(`wizard.goal.perceived.${p}`)}
                color={on ? 'primary' : 'default'}
                variant={on ? 'filled' : 'outlined'}
                aria-pressed={on}
                onClick={() => toggle(p)}
              />
            )
          })}
          <Chip label={t('wizard.goal.notSure')} variant="outlined" onClick={() => setGoal({ perceived: [] })} />
        </div>
      </div>
      <Typography variant="body2" color="text.secondary">{t('wizard.goal.helper')}</Typography>
    </div>
  )
}
