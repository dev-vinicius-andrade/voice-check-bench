import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { NoiseCutAmount } from '../../../../desktop/autotune/noiseCut'
import { useMsg } from '../../../common/MsgText'
import type { NoiseCut } from '../useNoiseCut'

const P = 'desktop.autotune.ui.noiseCut'
const AMOUNTS: readonly NoiseCutAmount[] = ['light', 'normal', 'strong']

/**
 * "Cut the noise" under "In your noise" (SPEC "Cut the noise"): how much, the button, and once applied what it did
 * with Undo; what the plan could not do; a refused change in plain words.
 */
export function NoiseCutPanel({ cut }: { cut: NoiseCut }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const { applied, busy } = cut
  return (
    <div className="grid gap-1" data-testid="noise-cut">
      <Typography variant="body2" color="text.secondary">{t(`${P}.help`)}</Typography>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={cut.amount}
          disabled={busy}
          aria-label={t(`${P}.amount.label`)}
          onChange={(_, x: NoiseCutAmount | null) => x && cut.setAmount(x)}
        >
          {AMOUNTS.map((a) => (
            <ToggleButton key={a} value={a}>{t(`${P}.amount.${a}`)}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        {!applied && (
          <Button variant="outlined" size="small" onClick={() => void cut.cut()} disabled={busy || cut.empty} data-testid="noise-cut-button">
            {t(cut.empty ? `${P}.nothing` : `${P}.cut`)}
          </Button>
        )}
      </div>
      {busy && cut.trying !== null && (
        <Typography variant="body2" color="text.secondary" data-testid="noise-cut-trying">{t(`${P}.trying`, { strength: cut.trying })}</Typography>
      )}
      {cut.amount === 'strong' && (
        <Typography variant="caption" color="warning.main" data-testid="noise-cut-strong">{t(`${P}.strongWarning`)}</Typography>
      )}
      {applied && (
        <Alert
          severity="success"
          data-testid="noise-cut-applied"
          action={
            <Button color="inherit" size="small" onClick={() => void cut.undo()} disabled={busy}>
              {t(`${P}.undo`)}
            </Button>
          }
        >
          {t(`${P}.applied`, { amount: t(`${P}.amount.${applied.amount}`) })}
        </Alert>
      )}
      {cut.error && <Alert severity="error" data-testid="noise-cut-error">{tm(cut.error)}</Alert>}
      {cut.notes.length > 0 && (
        <ul className="m-0 grid gap-1 pl-5" data-testid="noise-cut-notes">
          {cut.notes.map((m, i) => (
            <Typography component="li" variant="body2" key={`${m.key}-${i}`}>{tm(m)}</Typography>
          ))}
        </ul>
      )}
    </div>
  )
}
