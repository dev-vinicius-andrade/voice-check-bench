import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { DesktopRelease } from '../../downloads/releases'
import { fmtDate, fmtMb } from '../../i18n/format'
import { ChannelChip } from './LatestRelease'

/** Up to five other versions, one row each: version, channel, date, size, download link. */
export function OtherReleases({ releases }: { releases: readonly DesktopRelease[] }) {
  const { t } = useTranslation()
  return (
    <ul className="grid gap-3">
      {releases.slice(0, 5).map((r) => (
        <li key={r.tag} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={r.page} target="_blank" rel="noopener noreferrer" sx={{ fontWeight: 600 }}>
            {r.version}
          </Link>
          <ChannelChip prerelease={r.prerelease} />
          <Typography variant="body2" color="text.secondary" component="span">
            {fmtDate(r.publishedAt)} · {fmtMb(r.installer.sizeBytes)}
          </Typography>
          <Link href={r.installer.url} variant="body2" sx={{ ml: 'auto' }}>
            {t('pages.download.older.download')}
          </Link>
        </li>
      ))}
    </ul>
  )
}
