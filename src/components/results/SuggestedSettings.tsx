import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import { suggestionToJson, suggestionToText } from '../../settings/suggest'
import { useSuggestion } from '../../store/hooks'
import { isAnalysisError, type Suggestion } from '../../types'
import { downloadFile } from './download'
import { NoiseReductionCard } from './NoiseReductionCard'
import { PluginCard } from './PluginCard'
import { pluginCards, tagOf } from './pluginCards'

function ChainRow({ chain }: { chain: string[] }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t('results.settings.effectsOrder')}>
      <Typography variant="body2" color="text.secondary">{t('results.settings.effectsOrder')}</Typography>
      {chain.map((name, i) => (
        <span key={name} className="flex items-center gap-1.5">
          {i > 0 && <Typography component="span" variant="body2" color="text.secondary" aria-hidden="true">→</Typography>}
          <Chip size="small" variant="outlined" label={name} />
        </span>
      ))}
    </div>
  )
}

type CopyState = 'idle' | 'copied' | 'saved'

function useCopy(s: Suggestion): [CopyState, () => void] {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (): Promise<void> => {
    const text = suggestionToText(s)
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      downloadFile('reaplugs-settings.txt', text, 'text/plain')
      setState('saved')
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2000)
  }
  return [state, () => void copy()]
}

function SettingsPanel({ s }: { s: Suggestion }) {
  const { t } = useTranslation()
  const [copyState, copy] = useCopy(s)
  const copyLabel = copyState === 'copied' ? t('results.copy.copied') : copyState === 'saved' ? t('results.copy.saved') : t('results.settings.copyText')
  const a = isAnalysisError(s.base.analysis) ? null : s.base.analysis
  const based = [
    t('results.settings.basedOn', { name: s.base.name }),
    a ? t('results.settings.levels', { speech: fmtNum(a.speechMed, 1), noise: fmtNum(a.noise, 0) }) : '',
    t('results.settings.keepMic', { dist: s.dist }),
  ]
  return (
    <Paper
      component="section"
      id="suggested-settings"
      aria-label={t('results.settings.title')}
      className="grid scroll-mt-4 gap-3 p-4"
      sx={{ borderColor: 'primary.main' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Typography variant="h6" component="h2">{t('results.settings.title')}</Typography>
        <div className="flex flex-wrap gap-2">
          <Button size="small" variant="outlined" onClick={copy}>{copyLabel}</Button>
          <Button size="small" variant="outlined" onClick={() => downloadFile('reaplugs-settings.txt', suggestionToText(s), 'text/plain')}>
            {t('results.settings.downloadTxt')}
          </Button>
          <Button size="small" variant="outlined" onClick={() => downloadFile('reaplugs-settings.json', JSON.stringify(suggestionToJson(s), null, 2), 'application/json')}>
            {t('results.settings.downloadJson')}
          </Button>
        </div>
      </div>
      {s.noiseHint && <Alert severity="error">{s.noiseHint}</Alert>}
      {s.gainHint ? (
        <Alert severity="warning">{s.gainHint}</Alert>
      ) : (
        <Typography variant="body2" color="text.secondary">{based.filter(Boolean).join(' ')}</Typography>
      )}
      {s.chain?.length > 0 && <ChainRow chain={s.chain} />}
      {s.noiseReduction && <NoiseReductionCard plan={s.noiseReduction} tag={tagOf(t, s, s.noiseReduction.plugin)} />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pluginCards(t, s).map((p) => <PluginCard key={p.name} {...p} />)}
      </div>
      <Typography variant="body2" color="text.secondary">
        {t('results.settings.applyBefore')}{' '}
        <Box component="code" sx={{ color: 'text.primary', overflowWrap: 'anywhere' }}>python tools/apply-reaplugs.py reaplugs-settings.json --write</Box>{' '}
        {t('results.settings.applyAfter')}
      </Typography>
    </Paper>
  )
}

/** ReaPlugs settings built from the raw take (prototype renderSuggest). Hidden without a suggestion. */
export function SuggestedSettings() {
  const s = useSuggestion()
  return s ? <SettingsPanel s={s} /> : null
}
