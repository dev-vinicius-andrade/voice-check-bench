import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import DownloadIcon from '@mui/icons-material/Download'
import { useTranslation } from 'react-i18next'
import type { DesktopRelease } from '../../downloads/releases'
import { fmtDate, fmtMb } from '../../i18n/format'

/** Stable or Preview, matching the GitHub pre-release flag. */
export function ChannelChip({ prerelease }: { prerelease: boolean }) {
  const { t } = useTranslation()
  return (
    <Chip
      size="small"
      variant="outlined"
      color={prerelease ? 'warning' : 'success'}
      label={prerelease ? t('pages.download.preview') : t('pages.download.stable')}
    />
  )
}

/** The release offered first: version, date, size, the big download button, checksum and notes links. */
export function LatestRelease({ release }: { release: DesktopRelease }) {
  const { t } = useTranslation()
  return (
    <Paper variant="outlined" className="grid justify-items-center gap-4 p-6 text-center sm:p-8">
      <Typography variant="overline" color="text.secondary" component="p" sx={{ lineHeight: 1.5 }}>
        {t('pages.download.latest')}
      </Typography>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Typography variant="h5" component="p" sx={{ fontWeight: 700 }}>
          {t('pages.download.version', { version: release.version })}
        </Typography>
        <ChannelChip prerelease={release.prerelease} />
      </div>
      <Typography color="text.secondary" variant="body2">
        {t('pages.download.published', { date: fmtDate(release.publishedAt) })}
      </Typography>
      <Button variant="contained" size="large" href={release.installer.url} startIcon={<DownloadIcon />}>
        {t('pages.download.button')}
      </Button>
      <Typography color="text.secondary" variant="body2">
        {t('pages.download.size', { size: fmtMb(release.installer.sizeBytes) })}
      </Typography>
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-1">
        {release.checksumUrl && (
          <Link href={release.checksumUrl} variant="body2">
            {t('pages.download.checksum')}
          </Link>
        )}
        <Link href={release.page} variant="body2" target="_blank" rel="noopener noreferrer">
          {t('pages.download.notes')}
        </Link>
      </div>
      {release.prerelease && (
        <Alert severity="warning" variant="outlined" sx={{ textAlign: 'left' }}>
          {t('pages.download.previewNote')}
        </Alert>
      )}
    </Paper>
  )
}
