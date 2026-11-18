import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { AMOUNTS } from '../../../desktop/advice/prefs'
import { BOTHERS, TUNE_STYLES, USES, toggleBother } from '../../../desktop/autotune/goals'
import { ChipGroup, Choice } from './ChipGroup'
import type { TuneGoalsState } from './useTuneGoals'

/** Step 2: what the voice is for, the sound, what bothers the person, how much processing. */
export function GoalsStep({ goals: { goals, setGoals }, onTune, onBack }: { goals: TuneGoalsState; onTune: () => void; onBack: () => void }) {
  const { t } = useTranslation()
  return (
    <Paper component="section" className="grid gap-4 p-4" aria-labelledby="autotune-goals-title">
      <Typography id="autotune-goals-title" variant="h6" component="h2">{t('desktop.autotune.ui.goals.title')}</Typography>
      <ChipGroup title={t('desktop.autotune.ui.goals.use')}>
        {USES.map((u) => (
          <Choice key={u} label={t(`desktop.autotune.ui.goals.uses.${u}`)} on={goals.use === u} onClick={() => setGoals({ use: u })} />
        ))}
      </ChipGroup>
      <ChipGroup title={t('desktop.autotune.ui.goals.style')}>
        {TUNE_STYLES.map((s) => (
          <Choice key={s} label={t(`wizard.goal.style.${s}.name`)} on={goals.style === s} onClick={() => setGoals({ style: s })} />
        ))}
      </ChipGroup>
      <ChipGroup title={t('desktop.autotune.ui.goals.bothers')}>
        {BOTHERS.map((b) => (
          <Choice key={b} label={t(`desktop.autotune.ui.goals.bother.${b}`)} on={goals.bothers.includes(b)} onClick={() => setGoals({ bothers: toggleBother(goals.bothers, b) })} />
        ))}
      </ChipGroup>
      <ChipGroup title={t('desktop.autotune.ui.goals.amount')} hint={t('desktop.autotune.ui.goals.amountHint')}>
        {AMOUNTS.map((a) => (
          <Choice key={a} label={t(`desktop.tune.sound.amounts.${a}`)} on={goals.amount === a} onClick={() => setGoals({ amount: a })} />
        ))}
      </ChipGroup>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onBack}>{t('desktop.autotune.ui.goals.back')}</Button>
        <Button variant="contained" onClick={onTune}>{t('desktop.autotune.ui.goals.tune')}</Button>
      </div>
    </Paper>
  )
}
