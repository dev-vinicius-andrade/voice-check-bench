import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AMOUNTS, NOISE_MODES, type TuningPrefs } from '../../../desktop/advice/prefs'
import { useBench } from '../../../store/benchStore'
import type { PerceivedIssue } from '../../../types'
import { STYLES } from '../../common/goalTarget'

/** What the person can hear that an EQ band answers (TONE_EQ); "nasal" has no band, so it is not offered here. */
const HEARD: readonly PerceivedIssue[] = ['boomy', 'muffled', 'thin', 'harsh', 'sharpS', 'dull']

function Choice({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <Chip label={label} color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} aria-pressed={on} onClick={onClick} />
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="grid gap-1">
      <Typography id={id} variant="subtitle2" component="h3">{title}</Typography>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {children}
      </div>
    </div>
  )
}

interface YourSoundPanelProps {
  prefs: TuningPrefs
  onPrefs: (patch: Partial<TuningPrefs>) => void
}

/** "Your sound": the goal style, what the person hears, how much processing and the noise mode; advice follows it. */
export function YourSoundPanel({ prefs, onPrefs }: YourSoundPanelProps) {
  const { t } = useTranslation()
  const goal = useBench((s) => s.goal)
  const setGoal = useBench((s) => s.setGoal)
  const toggle = (p: PerceivedIssue): void =>
    setGoal({ perceived: goal.perceived.includes(p) ? goal.perceived.filter((x) => x !== p) : [...goal.perceived, p] })
  return (
    <Paper component="section" className="grid gap-3 p-4" aria-labelledby="tune-sound-title" data-testid="tune-sound">
      <div className="grid gap-0.5">
        <Typography id="tune-sound-title" variant="h6" component="h2">{t('desktop.tune.sound.title')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('desktop.tune.sound.hint')}</Typography>
      </div>
      <Group title={t('desktop.tune.sound.style')}>
        {STYLES.map((s) => (
          <Choice key={s} label={t(`wizard.goal.style.${s}.name`)} on={goal.style === s} onClick={() => setGoal({ style: s })} />
        ))}
      </Group>
      <Group title={t('desktop.tune.sound.hear')}>
        {HEARD.map((p) => (
          <Choice key={p} label={t(`desktop.tune.sound.issues.${p}`)} on={goal.perceived.includes(p)} onClick={() => toggle(p)} />
        ))}
        <Choice label={t('desktop.tune.sound.good')} on={goal.perceived.length === 0} onClick={() => setGoal({ perceived: [] })} />
      </Group>
      <Group title={t('desktop.tune.sound.amount')}>
        {AMOUNTS.map((a) => (
          <Choice key={a} label={t(`desktop.tune.sound.amounts.${a}`)} on={prefs.amount === a} onClick={() => onPrefs({ amount: a })} />
        ))}
      </Group>
      <Group title={t('desktop.tune.sound.noise')}>
        {NOISE_MODES.map((n) => (
          <Choice key={n} label={t(`desktop.tune.sound.noises.${n}`)} on={prefs.noise === n} onClick={() => onPrefs({ noise: n })} />
        ))}
      </Group>
      <Typography variant="body2" color="text.secondary">{t('desktop.tune.sound.footnote')}</Typography>
    </Paper>
  )
}
