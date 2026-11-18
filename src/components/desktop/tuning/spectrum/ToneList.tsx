import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtHz, fmtNum } from '../../../../i18n/format'
import type { ToneRow } from './useToneCuts'

/** A row of the list with whatever the screen keeps of a cut (the live chain's entries, the result step's values). */
export type ToneListRow<C extends { n: number }> = Omit<ToneRow, 'cut'> & { cut: C | null }

interface ToneListProps<C extends { n: number }> {
  rows: readonly ToneListRow<C>[]
  /** Not everything has been heard yet ("Listening…" instead of "none"). */
  listening: boolean
  /** A ReaEQ is on (Cut can be offered). */
  canCut: boolean
  onCut: (row: ToneListRow<C>) => void
  onUndo: (cut: C) => void
}

/** Steady tones under the plot: "Steady tone at 923 Hz · 30 dB over its surroundings" with Cut, or the cut made and its Undo. */
export function ToneList<C extends { n: number }>({ rows, listening, canCut, onCut, onUndo }: ToneListProps<C>) {
  const { t } = useTranslation()
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="spectrum-tones-empty">
        {t(listening ? 'desktop.tune.spectrum.tones.listening' : 'desktop.tune.spectrum.tones.none')}
      </Typography>
    )
  }
  return (
    <ul className="m-0 grid list-none gap-1 p-0" data-testid="spectrum-tones">
      {rows.map((r) => {
        const hz = fmtHz(r.tone.freqHz)
        return (
          <li key={r.cut ? `cut${r.cut.n}` : r.tone.freqHz} className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="spectrum-tone">
            <Typography variant="body2" className="min-w-0 flex-1">
              {`${t('desktop.tune.spectrum.tones.tone', { hz })} · ${t('desktop.tune.spectrum.tones.over', { db: fmtNum(r.tone.overDb, 0) })}`}
            </Typography>
            {r.cut ? (
              <>
                <Typography variant="body2" color="text.secondary">{t('desktop.tune.spectrum.tones.cutWith', { n: r.cut.n })}</Typography>
                <Button size="small" variant="outlined" aria-label={t('desktop.tune.spectrum.tones.undoAria', { hz })} onClick={() => r.cut && onUndo(r.cut)}>
                  {t('desktop.tune.spectrum.tones.undo')}
                </Button>
              </>
            ) : r.plan ? (
              <Button size="small" variant="contained" aria-label={t('desktop.tune.spectrum.tones.cutAria', { hz })} onClick={() => onCut(r)}>
                {t('desktop.tune.spectrum.tones.cut')}
              </Button>
            ) : (
              canCut && (
                <Typography variant="body2" color="info.main" data-testid="spectrum-no-band">
                  {t('desktop.tune.spectrum.tones.noBand')}
                </Typography>
              )
            )}
          </li>
        )
      })}
    </ul>
  )
}
