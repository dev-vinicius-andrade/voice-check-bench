// "Try AI noise removal first" step of the Wave Link path (suggestion.noiseReduction.preferAi): Elgato Noise Removal
// or NVIDIA Broadcast, each with "if it sounds clean, skip ReaFIR", plus the "Use ReaFIR instead" path.
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { NrChoice } from './nrChoice'
import { StepNote, StepText } from './StepText'

const OPTIONS = [
  { choice: 'ai-elgato', key: 'elgato' },
  { choice: 'ai-nvidia', key: 'nvidia' },
] as const

const CHOSEN: Record<NrChoice, string> = { 'ai-elgato': 'elgato', 'ai-nvidia': 'nvidia', reafir: 'reafir' }

function Pick({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return (
    <div>
      <Button variant={selected ? 'contained' : 'outlined'} aria-pressed={selected} onClick={onClick}>{label}</Button>
    </div>
  )
}

export function AiNoiseStep({ choice, onChoose }: { choice: NrChoice | null; onChoose: (c: NrChoice) => void }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4">
      <StepText lead={t('guide.wl.ai.lead')} actions={[]} />
      {OPTIONS.map((o) => (
        <section key={o.key} className="grid gap-2">
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>{t(`guide.wl.ai.${o.key}.title`)}</Typography>
          <StepText actions={[{ text: t(`guide.wl.ai.${o.key}.a1`) }, { text: t(`guide.wl.ai.${o.key}.a2`) }, { text: t('guide.wl.ai.skip') }]} />
          <Pick selected={choice === o.choice} label={t(`guide.wl.ai.${o.key}.pick`)} onClick={() => onChoose(o.choice)} />
        </section>
      ))}
      <section className="grid gap-2">
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>{t('guide.wl.ai.reafir.title')}</Typography>
        <StepText lead={t('guide.wl.ai.reafir.lead')} actions={[]} />
        <Pick selected={choice === 'reafir'} label={t('guide.wl.ai.reafir.pick')} onClick={() => onChoose('reafir')} />
      </section>
      {choice && <StepNote>{t(`guide.wl.ai.chosen.${CHOSEN[choice]}`)}</StepNote>}
    </div>
  )
}
