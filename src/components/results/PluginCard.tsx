import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

export interface PluginCardProps {
  name: string
  tag: string
  rows: [string, string][]
  why: string
}

/** One plugin's settings: key/value rows with mono values and a muted reason (prototype plug()). */
export function PluginCard({ name, tag, rows, why }: PluginCardProps) {
  return (
    <Paper className="grid content-start gap-1 px-3 py-2.5">
      <div className="flex justify-between gap-2">
        <Typography sx={{ fontWeight: 700 }}>{name}</Typography>
        {tag && <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{tag}</Typography>}
      </div>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <Typography component="dt" variant="body2">{k}</Typography>
            <Typography component="dd" variant="body2" className="m-0 text-right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {v}
            </Typography>
          </div>
        ))}
      </dl>
      {why && <Typography variant="caption" color="text.secondary">{why}</Typography>}
    </Paper>
  )
}
