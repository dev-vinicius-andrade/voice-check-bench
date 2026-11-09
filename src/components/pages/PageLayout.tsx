import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { TwoToneHeading } from '../common/TwoToneHeading'
import { useBench } from '../../store/benchStore'

/** Centered page column shared by the site pages. */
export function PageColumn({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto grid w-full max-w-[880px] gap-12 py-6 sm:py-10">{children}</div>
}

/** Page head: optional overline, two-tone heading and a lead paragraph. */
export function PageHead({ overline, first, second, lead }: { overline?: string; first: string; second: string; lead?: React.ReactNode }) {
  return (
    <header className="grid gap-4 text-center">
      {overline && (
        <Typography variant="overline" color="primary" component="p" sx={{ lineHeight: 1.5 }}>
          {overline}
        </Typography>
      )}
      <TwoToneHeading first={first} second={second} variant="h3" />
      {lead && (
        <Typography color="text.secondary" sx={{ maxWidth: '60ch', mx: 'auto', fontSize: 17 }}>
          {lead}
        </Typography>
      )}
    </header>
  )
}

/** A titled section with an h2-style heading. */
export function PageSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <Typography variant="h5" component="h2" sx={{ textTransform: 'uppercase' }}>
        {title}
      </Typography>
      {children}
    </section>
  )
}

/** Plain body paragraph in the secondary text color. */
export function Para({ children }: { children: React.ReactNode }) {
  return (
    <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
      {children}
    </Typography>
  )
}

/** Inline code (commands, file names). */
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="code"
      sx={{ px: 0.75, py: 0.25, borderRadius: 1, bgcolor: 'action.hover', fontSize: '0.9em', overflowWrap: 'anywhere' }}
    >
      {children}
    </Box>
  )
}

/** Primary pill that starts the check. */
export function StartButton({ label = 'Start the 5-minute check →' }: { label?: string }) {
  const goTo = useBench((s) => s.goTo)
  return (
    <Button variant="contained" size="large" onClick={() => goTo('setup')}>
      {label}
    </Button>
  )
}

/** Closing call to action at the end of a page. */
export function PageCta({ text }: { text: string }) {
  return (
    <div className="grid justify-items-center gap-3 text-center">
      <Typography color="text.secondary">{text}</Typography>
      <StartButton />
    </div>
  )
}
