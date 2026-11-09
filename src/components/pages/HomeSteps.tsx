import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

const STEPS = [
  { title: 'Tell us your mic', sub: 'Model, type, pattern' },
  { title: 'Three raw takes', sub: '2, 8 and 15 cm' },
  { title: 'One take with your effects', sub: 'Before vs after' },
  { title: 'Your settings', sub: 'Copy or apply' },
] as const

/** The four steps of the check as numbered cards (4 → 2 → 1 columns). */
export function HomeSteps() {
  return (
    <section aria-label="How the check goes" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {STEPS.map((s, i) => (
        <Paper key={s.title} className="grid content-start gap-1 p-4">
          <Typography variant="h4" component="p" color="primary">
            {i + 1}
          </Typography>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            {s.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {s.sub}
          </Typography>
        </Paper>
      ))}
    </section>
  )
}
