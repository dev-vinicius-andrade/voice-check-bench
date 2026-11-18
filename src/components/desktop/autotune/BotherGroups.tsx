import Typography from '@mui/material/Typography'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BOTHER_GROUPS, type BotherGroupId } from '../../../desktop/autotune/goals'
import type { Bother } from '../../../desktop/tune'
import { Choice } from './ChipGroup'

interface BotherGroupsProps {
  /** The heading of the whole list ("What bothers you"). */
  title: string
  isOn: (b: Bother) => boolean
  onToggle: (b: Bother) => void
  /** Chips put first in a group (the adjust panel's "Too processed" in processing). */
  extra?: Partial<Record<BotherGroupId, ReactNode>>
}

/** One small heading and its chips (role group, labelled by the heading). */
function Group({ id, children }: { id: BotherGroupId; children: ReactNode }) {
  const { t } = useTranslation()
  const label = useId()
  return (
    <div className="grid gap-1">
      <Typography id={label} variant="caption" component="h4" color="text.secondary">{t(`desktop.autotune.ui.goals.groups.${id}`)}</Typography>
      <div role="group" aria-labelledby={label} className="flex flex-wrap gap-2">
        {children}
      </div>
    </div>
  )
}

/** "What bothers you" under four small headings (noise, tone, volume, processing): the goals step and the adjust panel. */
export function BotherGroups({ title, isOn, onToggle, extra = {} }: BotherGroupsProps) {
  const { t } = useTranslation()
  const heading = useId()
  return (
    <section className="grid gap-2" aria-labelledby={heading}>
      <Typography id={heading} variant="subtitle2" component="h3">{title}</Typography>
      {BOTHER_GROUPS.map((g) => (
        <Group key={g.id} id={g.id}>
          {extra[g.id]}
          {g.bothers.map((b) => (
            <Choice key={b} label={t(`desktop.autotune.ui.goals.bother.${b}`)} on={isOn(b)} onClick={() => onToggle(b)} />
          ))}
        </Group>
      ))}
    </section>
  )
}
