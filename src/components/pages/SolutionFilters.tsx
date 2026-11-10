import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { useTranslation } from 'react-i18next'
import { SOLUTION_ROOMS, SOLUTION_SORTS, SOLUTION_STYLES, type SolutionRoom, type SolutionSort } from '../../community/solutions'
import type { VoiceStyle } from '../../types'
import type { SolutionFilterState } from './useSolutionFilter'

const STYLE_OPTIONS = ['any', ...SOLUTION_STYLES] as const

function Pick<T extends string>({ id, label, value, options, onChange }: {
  id: string
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <FormControl size="small" className="min-w-[160px] grow sm:grow-0">
      <InputLabel id={`${id}-label`}>{label}</InputLabel>
      <Select labelId={`${id}-label`} id={id} label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

/** Mic · voice style · room · sort for the shared settings list. Wraps on narrow screens. */
export function SolutionFilters({ state }: { state: SolutionFilterState }) {
  const { t } = useTranslation()
  const { filter, set, micOptions } = state
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="solution-filters">
      <Pick
        id="solution-mic"
        label={t('pages.community.solutions.filter.mic')}
        value={filter.mic}
        options={[{ value: 'all', label: t('pages.community.solutions.filter.allMics') }, ...micOptions.map((m) => ({ value: m.key, label: m.model }))]}
        onChange={(mic) => set({ mic })}
      />
      <Pick<VoiceStyle | 'any'>
        id="solution-style"
        label={t('pages.community.solutions.filter.style')}
        value={filter.style}
        options={STYLE_OPTIONS.map((s) => ({ value: s, label: s === 'any' ? t('pages.community.solutions.filter.anyStyle') : t(`wizard.goal.style.${s}.name`) }))}
        onChange={(style) => set({ style })}
      />
      <ToggleButtonGroup
        size="small"
        exclusive
        value={filter.room}
        onChange={(_e, room: SolutionRoom | null) => room && set({ room })}
        aria-label={t('pages.community.solutions.filter.room')}
      >
        {SOLUTION_ROOMS.map((r) => (
          <ToggleButton key={r} value={r} sx={{ textTransform: 'none', px: 1.5 }}>
            {t(`pages.community.solutions.room.${r}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Pick<SolutionSort>
        id="solution-sort"
        label={t('pages.community.solutions.filter.sort')}
        value={filter.sort}
        options={SOLUTION_SORTS.map((s) => ({ value: s, label: t(`pages.community.solutions.sort.${s}`) }))}
        onChange={(sort) => set({ sort })}
      />
    </div>
  )
}
