import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { Trans, useTranslation } from 'react-i18next'
import { fmtDb, fmtHz, fmtNum } from '../../i18n/format'
import type { Analysis } from '../../types'
import { BandSnrChart } from './BandSnrChart'
import { hasBandSnr } from './roomNoise'

/** Room noise of take A: level and kind, steady tones, and how far the voice beats the room per octave. */
export function RoomNoisePanel({ a }: { a: Analysis }) {
  const { t } = useTranslation()
  const kind = a.noiseKind ? t(`results.noiseKind.${a.noiseKind}`) : null
  const tones = a.tones ?? []
  const bands = hasBandSnr(a)
  return (
    <section aria-label={t('results.room.title')} className="grid gap-2">
      <div>
        <Typography variant="h6" component="h2">{t('results.room.title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {a.noiseFromQuiet ? t('results.room.fromQuiet') : t('results.room.estimated')}
          {bands && ` ${t('results.room.bars')}`}
        </Typography>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          <Trans i18nKey="results.room.noiseFloor" values={{ value: fmtNum(a.noise, 1) }} components={{ b: <b /> }} />
        </Typography>
        {kind && (
          <Chip size="small" label={kind} color={a.noiseKind === 'quiet' ? 'success' : 'warning'} variant="outlined" />
        )}
      </div>
      {tones.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Typography variant="caption" color="text.secondary">{t('results.room.steadyTones')}</Typography>
          {tones.map((tone) => (
            <Chip key={tone.hz} size="small" label={`${fmtHz(tone.hz)} ${fmtDb(tone.db, 0)}`} />
          ))}
        </div>
      )}
      {bands && (
        <div className="overflow-x-auto">
          <BandSnrChart snr={a.bandSnr} />
        </div>
      )}
    </section>
  )
}
