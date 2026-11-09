import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

export interface DefItem {
  term: string
  def: React.ReactNode
}

/** Definition list in a flat bordered card: term on top, plain sentence below. */
export function DefList({ items }: { items: readonly DefItem[] }) {
  return (
    <Box component="dl" sx={{ m: 0, border: 1, borderColor: 'divider', borderRadius: 2.5 }}>
      {items.map((it, i) => (
        <Box key={it.term} sx={{ px: 2.5, py: 1.75, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
          <Typography component="dt" sx={{ fontWeight: 700 }}>
            {it.term}
          </Typography>
          <Typography component="dd" color="text.secondary" sx={{ m: 0, mt: 0.5, lineHeight: 1.7 }}>
            {it.def}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

/** Bulleted list with body text in the secondary color. */
export function BulletList({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 3, display: 'grid', gap: 1, color: 'text.secondary', lineHeight: 1.7 }}>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </Box>
  )
}
