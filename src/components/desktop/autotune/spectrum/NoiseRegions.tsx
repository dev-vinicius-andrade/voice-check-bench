import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { AUDIBLE_UNDER_DB, type NoiseRegion, type VoiceNoise } from '../../../../desktop/spectrum/voiceNoise'
import { fmtDb, fmtDbfs } from '../../../../i18n/format'

/** At or under this the noise is shown as silence, dBFS. */
const SILENT_DB = -120

const P = 'desktop.autotune.ui.spectrum.noise'

/**
 * "In your noise": the noise of the take (Before) and of the render After plays, low / mid / high, each with how far
 * under the voice it is after and an "audible" tag when that is under AUDIBLE_UNDER_DB.
 */
export function NoiseRegions({ before, after }: { before: VoiceNoise; after: VoiceNoise }) {
  const { t } = useTranslation()
  const level = (db: number): string => (db <= SILENT_DB ? t('desktop.autotune.ui.result.metrics.note.silence') : fmtDbfs(db))
  return (
    <section className="grid gap-1" aria-labelledby="autotune-noise-title" data-testid="take-noise">
      <Typography id="autotune-noise-title" variant="subtitle2" component="h4">{t(`${P}.title`)}</Typography>
      <ul className="m-0 grid list-none gap-1 p-0">
        {after.regions.map((a: NoiseRegion) => {
          const b = before.regions.find((r) => r.id === a.id)
          const silent = a.noiseDb <= SILENT_DB
          return (
            <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5" data-testid={`take-noise-${a.id}`}>
              <Typography variant="body2" className="min-w-0 flex-1">{t(`${P}.${a.id}`)}</Typography>
              <span className="flex flex-wrap items-center gap-x-3">
                <Typography variant="body2" component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {b ? level(b.noiseDb) : '–'} → {level(a.noiseDb)}
                </Typography>
                {!silent && (
                  <Typography variant="body2" component="span" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {t(`${P}.under`, { db: fmtDb(a.underVoiceDb, 1, false) })}
                  </Typography>
                )}
                {a.underVoiceDb < AUDIBLE_UNDER_DB && (
                  <Chip size="small" variant="outlined" color="warning" label={t(`${P}.audible`)} data-testid="take-noise-audible" />
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <Typography variant="caption" color="text.secondary">{t(`${P}.caption`)}</Typography>
    </section>
  )
}
