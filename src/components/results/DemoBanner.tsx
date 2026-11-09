import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { DEMO_SESSION } from '../../demo/demoTakes'
import { dismissDemoBanner, exitDemo, useDemo } from '../../demo/demoSession'
import { useBench } from '../../store/benchStore'

/** "Example data" notice while the results show the demo session (take A is a demo take). */
export function DemoBanner() {
  const { t } = useTranslation()
  const active = useDemo((s) => s.active && !s.dismissed)
  const showingDemo = useBench((s) => s.takes.some((t) => t.id === s.A && t.session === DEMO_SESSION))
  if (!active || !showingDemo) return null
  return (
    <Alert severity="info" onClose={dismissDemoBanner}>
      <div className="grid justify-items-start gap-2">
        <span>{t('results.demo.body')}</span>
        <Button variant="outlined" color="info" size="small" onClick={exitDemo}>
          {t('results.demo.start')}
        </Button>
      </div>
    </Alert>
  )
}
