import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { screenToHash } from '../../hooks/useHashRoute'
import { useBench } from '../../store/benchStore'
import { ProgressStepper } from './ProgressStepper'
import { SiteNav } from './SiteNav'

/** Three rounded bars: the product mark. */
function WaveMark() {
  return (
    <Box component="svg" viewBox="0 0 18 18" width={18} height={18} aria-hidden="true" sx={{ color: 'primary.main', flex: 'none' }}>
      <rect x="1" y="6" width="4" height="6" rx="2" fill="currentColor" />
      <rect x="7" y="1" width="4" height="16" rx="2" fill="currentColor" />
      <rect x="13" y="4" width="4" height="10" rx="2" fill="currentColor" />
    </Box>
  )
}

/** Brand (→ home) and site nav; the progress stepper is a second row on the wizard screens. */
export function TopBar() {
  const wizard = useBench((s) => s.screen === 'setup' || s.screen === 'step' || s.screen === 'results')
  return (
    <Box component="header" sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href={screenToHash('home')} underline="none" color="inherit" className="flex items-center gap-2">
          <WaveMark />
          <Typography component="span" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 15 }}>
            Voice Check Bench
          </Typography>
        </Link>
        <SiteNav />
      </div>
      {wizard && (
        <div className="mx-auto max-w-[1240px] px-4 pb-2">
          <ProgressStepper />
        </div>
      )}
    </Box>
  )
}
