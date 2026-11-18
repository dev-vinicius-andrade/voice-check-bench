import Button from '@mui/material/Button'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useAbPlayer, type AbSide } from './useAbPlayer'

/** Before / After on the same take: Play / Pause and a switch that keeps the position. */
export function AbPlayer({ before, after }: { before: Float32Array; after: Float32Array }) {
  const { t } = useTranslation()
  const p = useAbPlayer(before, after)
  return (
    <section className="grid gap-2" aria-labelledby="autotune-ab-title">
      <Typography id="autotune-ab-title" variant="subtitle1" component="h3">{t('desktop.autotune.ui.result.listen')}</Typography>
      {p.supported ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="contained" onClick={p.toggle}>
              {t(p.playing ? 'desktop.autotune.ui.result.pause' : 'desktop.autotune.ui.result.play')}
            </Button>
            <ToggleButtonGroup exclusive size="small" value={p.side} aria-labelledby="autotune-ab-title" onChange={(_, v: AbSide | null) => v && p.pick(v)}>
              <ToggleButton value="before">{t('desktop.autotune.ui.result.before')}</ToggleButton>
              <ToggleButton value="after">{t('desktop.autotune.ui.result.after')}</ToggleButton>
            </ToggleButtonGroup>
          </div>
          <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.result.abHint')}</Typography>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.result.noAudio')}</Typography>
      )}
    </section>
  )
}
