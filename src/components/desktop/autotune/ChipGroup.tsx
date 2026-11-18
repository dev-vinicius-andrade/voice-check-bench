import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { useId, type ReactNode } from 'react'

export function Choice({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <Chip label={label} color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} aria-pressed={on} onClick={onClick} />
}

/** A titled row of chips (role group, labelled by its title). */
export function ChipGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="grid gap-1">
      <Typography id={id} variant="subtitle2" component="h3">{title}</Typography>
      {hint && <Typography variant="body2" color="text.secondary">{hint}</Typography>}
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {children}
      </div>
    </div>
  )
}
