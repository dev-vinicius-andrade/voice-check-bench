import NoiseControlOffIcon from '@mui/icons-material/NoiseControlOff'
import GroupsIcon from '@mui/icons-material/Groups'
import LockIcon from '@mui/icons-material/Lock'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

const FEATURES = [
  {
    icon: NoiseControlOffIcon,
    title: 'Built for noisy rooms',
    text: 'Finds fan and server tones, measures voice vs room per band, and adds noise reduction and notches.',
  },
  {
    icon: GroupsIcon,
    title: "Learn from your mic's owners",
    text: 'Compare with people who share results for the same model.',
  },
  {
    icon: LockIcon,
    title: 'Private by default',
    text: 'Audio never leaves your browser. Sharing is opt-in.',
  },
] as const

/** Three feature cards with icons (3 → 1 columns). */
export function HomeFeatures() {
  return (
    <section aria-label="Features" className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {FEATURES.map(({ icon: Icon, title, text }) => (
        <Paper key={title} className="grid content-start gap-2 p-5">
          <Icon color="primary" fontSize="large" aria-hidden />
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {text}
          </Typography>
        </Paper>
      ))}
    </section>
  )
}
