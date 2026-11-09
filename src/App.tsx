import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'

const screens = ['Setup', 'Step', 'Results']

export default function App() {
  return (
    <main className="p-6">
      <Typography variant="h4" component="h1" align="center">
        Voice Check Bench
      </Typography>
      <div className="flex gap-2 justify-center p-6">
        {screens.map((name) => (
          <Chip key={name} label={name} variant="outlined" />
        ))}
      </div>
    </main>
  )
}
