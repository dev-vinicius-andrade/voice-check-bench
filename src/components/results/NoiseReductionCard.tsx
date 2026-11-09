import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { NoiseReductionGuide } from '../../types'
import { useMsg } from '../common/MsgText'

/** The manual noise-reduction setup (ReaFIR steps) and the alternatives, styled like a plugin card. */
export function NoiseReductionCard({ plan, tag }: { plan: NoiseReductionGuide; tag: string }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const steps = plan.steps ?? []
  const alternatives = plan.alternatives ?? []
  return (
    <Paper className="grid content-start gap-1.5 px-3 py-2.5">
      <div className="flex justify-between gap-2">
        <Typography sx={{ fontWeight: 700 }}>{t('results.settings.nrTitle', { plugin: plan.plugin })}</Typography>
        {tag && <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{tag}</Typography>}
      </div>
      {steps.length > 0 && (
        <ol className="m-0 grid list-decimal gap-1 pl-5">
          {steps.map((step) => (
            <Typography key={step.key} component="li" variant="body2">{tm(step)}</Typography>
          ))}
        </ol>
      )}
      {alternatives.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {t('results.settings.nrAlternatives', { plugin: plan.plugin, list: alternatives.map(tm).join(' · ') })}
        </Typography>
      )}
    </Paper>
  )
}
