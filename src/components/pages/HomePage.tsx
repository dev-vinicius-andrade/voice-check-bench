import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { loadDemoSession } from '../../demo/demoSession'
import { HomeFeatures } from './HomeFeatures'
import { HomeSteps } from './HomeSteps'
import { PageColumn, PageHead, StartButton } from './PageLayout'

/** Landing page: hero, the four steps, features and the compatibility line. */
export function HomePage() {
  return (
    <PageColumn>
      <div className="grid gap-6">
        <PageHead
          overline="Free · in your browser · nothing uploaded"
          first="Sound clearer"
          second="in the room you have"
          lead="Record four short takes. See what makes your voice unclear, and get settings that work with your mic, your interface and your noise."
        />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <StartButton />
          <Button variant="text" size="large" onClick={() => loadDemoSession()}>
            See an example result
          </Button>
        </div>
      </div>
      <HomeSteps />
      <HomeFeatures />
      <Typography variant="body2" color="text.secondary" align="center">
        Works best in Chrome or Edge · Wave Link + ReaPlugs supported · Open source on GitHub
      </Typography>
    </PageColumn>
  )
}
