import Button from '@mui/material/Button'
import Slider from '@mui/material/Slider'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SaveWav } from '../../../desktop/bridge'
import { fmtClock } from '../../../i18n/format'
import { TakeDownloads } from './TakeDownloads'
import { useAbPlayer, type AbSide } from './useAbPlayer'

const num = (v: number | readonly number[]): number => (typeof v === 'number' ? v : (v[0] ?? 0))

/**
 * Before / After on the same take: Play / Pause, Stop (back to the start), a switch that keeps the position, a seek bar
 * with elapsed / total time, and a WAV download of each side.
 */
export function AbPlayer({ before, after, saveWav }: { before: Float32Array; after: Float32Array; saveWav?: SaveWav }) {
  const { t } = useTranslation()
  const p = useAbPlayer(before, after)
  // while the thumb is dragged it shows where it is; the take moves there when it is let go
  const [scrub, setScrub] = useState<number | null>(null)
  const shown = scrub ?? p.position
  return (
    <section className="grid gap-2" aria-labelledby="autotune-ab-title">
      <Typography id="autotune-ab-title" variant="subtitle1" component="h3">{t('desktop.autotune.ui.result.listen')}</Typography>
      {p.supported ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="contained" onClick={p.toggle}>
              {t(p.playing ? 'desktop.autotune.ui.result.pause' : 'desktop.autotune.ui.result.play')}
            </Button>
            <Button variant="outlined" onClick={p.stop}>
              {t('desktop.autotune.ui.result.stop')}
            </Button>
            <ToggleButtonGroup exclusive size="small" value={p.side} aria-labelledby="autotune-ab-title" onChange={(_, v: AbSide | null) => v && p.pick(v)}>
              <ToggleButton value="before">{t('desktop.autotune.ui.result.before')}</ToggleButton>
              <ToggleButton value="after">{t('desktop.autotune.ui.result.after')}</ToggleButton>
            </ToggleButtonGroup>
          </div>
          <div className="flex items-center gap-4">
            <Slider
              size="small"
              aria-label={t('desktop.autotune.ui.result.position')}
              min={0}
              max={Math.max(p.duration, 0.1)}
              step={0.1}
              value={Math.min(shown, p.duration)}
              getAriaValueText={fmtClock}
              onChange={(_, v) => setScrub(num(v))}
              onChangeCommitted={(_, v) => {
                setScrub(null)
                p.seek(num(v))
              }}
            />
            <Typography variant="body2" className="shrink-0" sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="autotune-ab-time">
              {t('desktop.autotune.ui.result.time', { elapsed: fmtClock(shown), total: fmtClock(p.duration) })}
            </Typography>
          </div>
          <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.result.abHint')}</Typography>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.result.noAudio')}</Typography>
      )}
      <TakeDownloads before={before} after={after} saveWav={saveWav} />
    </section>
  )
}
