import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import { DEMO_SESSION } from '../../demo/demoTakes'
import { dismissDemoBanner, exitDemo, useDemo } from '../../demo/demoSession'
import { useBench } from '../../store/benchStore'

/** "Example data" notice while the results show the demo session (take A is a demo take). */
export function DemoBanner() {
  const active = useDemo((s) => s.active && !s.dismissed)
  const showingDemo = useBench((s) => s.takes.some((t) => t.id === s.A && t.session === DEMO_SESSION))
  if (!active || !showingDemo) return null
  return (
    <Alert severity="info" onClose={dismissDemoBanner}>
      <div className="grid justify-items-start gap-2">
        <span>This is example data — your own takes are not affected.</span>
        <Button variant="outlined" color="info" size="small" onClick={exitDemo}>
          Start your own check
        </Button>
      </div>
    </Alert>
  )
}
