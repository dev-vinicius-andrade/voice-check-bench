import { useEffect, useRef, useState } from 'react'
import { fmtHz } from './roomNoise'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { suggestionToJson, suggestionToText } from '../../settings/suggest'
import { isAnalysisError, type Suggestion } from '../../types'
import { downloadFile } from './download'
import { NoiseReductionCard } from './NoiseReductionCard'
import { PluginCard, type PluginCardProps } from './PluginCard'
import { useSuggestion } from '../../store/hooks'

const sg = (v: number | string): string => (Number(v) > 0 ? '+' : '') + v
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th']
const DEFAULT_CHAIN = ['ReaGate', 'ReaEQ', 'ReaComp']
/** Plugin order to set up; older suggestions without a chain use the classic gate → EQ → compressor. */
const chainOf = (s: Suggestion): string[] => (s.chain?.length ? s.chain : DEFAULT_CHAIN)
const tagOf = (s: Suggestion, name: string): string => ORDINALS[chainOf(s).indexOf(name)] ?? ''
const eqLabel = (type: string, bw: number): string => (bw < 0.3 ? `${type} · notch` : type)

function plugins(s: Suggestion): PluginCardProps[] {
  const g = s.gate
  const c = s.comp
  const reaplugs: PluginCardProps[] = [
    { name: 'ReaGate', tag: tagOf(s, 'ReaGate'), rows: [['Threshold', `${g.threshold} dB`], ['Attack', `${g.attack} ms`], ['Hold', `${g.hold} ms`], ['Release', `${g.release} ms`], ['Hysteresis', `${g.hysteresis} dB`], ['Wet / Dry', `${g.wet} / ${g.dry} dB`]], why: s.noisyRoom ? 'Soft expander just above the room left after noise reduction: pauses dip, words stay whole.' : 'About 12 dB above the room noise, well under your voice.' },
    {
      name: 'ReaEQ', tag: tagOf(s, 'ReaEQ'),
      rows: s.eq.length
        ? s.eq.map((e, i): [string, string] => [`${i + 1}. ${eqLabel(e.type, e.bw)}`, `${fmtHz(e.freq)} · ${sg(e.gain.toFixed(1))} · ${e.bw.toFixed(1)}`])
        : [['No bands needed', '—']],
      why: 'Frequency · gain dB · bandwidth oct. Use only these bands.',
    },
    { name: 'ReaComp', tag: tagOf(s, 'ReaComp'), rows: [['Threshold', `${c.threshold} dB`], ['Ratio', `${c.ratio}:1`], ['Attack / Release', `${c.attack} / ${c.release} ms`], ['Knee size', `${c.knee} dB`], ['Wet (makeup)', `${sg(c.wet)} dB`], ['Limit output', 'on']], why: 'Aims for speech around -20 dBFS.' },
  ]
  const order = chainOf(s)
  reaplugs.sort((x, y) => (order.indexOf(x.name) + 1 || 99) - (order.indexOf(y.name) + 1 || 99))
  return [
    { name: 'Wave XLR', tag: 'hardware', rows: [['Lowcut Filter', `${s.lowcut} Hz`]], why: s.lowcut === 120 ? 'Extra rumble on the raw mic.' : '' },
    ...reaplugs,
    { name: 'Elgato De-Esser', tag: '', rows: [['State', s.deess ? 'on (light)' : 'off']], why: s.deess ? 'S sounds spike on the raw mic.' : '' },
  ]
}

function ChainRow({ chain }: { chain: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Effects order">
      <Typography variant="body2" color="text.secondary">Effects order:</Typography>
      {chain.map((name, i) => (
        <span key={name} className="flex items-center gap-1.5">
          {i > 0 && <Typography component="span" variant="body2" color="text.secondary" aria-hidden="true">→</Typography>}
          <Chip size="small" variant="outlined" label={name} />
        </span>
      ))}
    </div>
  )
}

function useCopy(s: Suggestion): [string, () => void] {
  const [label, setLabel] = useState('Copy as text')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (): Promise<void> => {
    const text = suggestionToText(s)
    try {
      await navigator.clipboard.writeText(text)
      setLabel('Copied ✓')
    } catch {
      downloadFile('reaplugs-settings.txt', text, 'text/plain')
      setLabel('Saved as file')
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLabel('Copy as text'), 2000)
  }
  return [label, () => void copy()]
}

function SettingsPanel({ s }: { s: Suggestion }) {
  const [copyLabel, copy] = useCopy(s)
  const a = isAnalysisError(s.base.analysis) ? null : s.base.analysis
  return (
    <Paper component="section" aria-label="Suggested ReaPlugs settings" className="grid gap-3 p-4" sx={{ borderColor: 'primary.main' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Typography variant="h6" component="h2">Suggested ReaPlugs settings</Typography>
        <div className="flex flex-wrap gap-2">
          <Button size="small" variant="outlined" onClick={copy}>{copyLabel}</Button>
          <Button size="small" variant="outlined" onClick={() => downloadFile('reaplugs-settings.txt', suggestionToText(s), 'text/plain')}>Download .txt</Button>
          <Button size="small" variant="outlined" onClick={() => downloadFile('reaplugs-settings.json', JSON.stringify(suggestionToJson(s), null, 2), 'application/json')}>Download .json</Button>
        </div>
      </div>
      {s.noiseHint && <Alert severity="error">{s.noiseHint}</Alert>}
      {s.gainHint ? (
        <Alert severity="warning">{s.gainHint}</Alert>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Based on the raw take “{s.base.name}”.
          {a && ` Speech ${a.speechMed.toFixed(1)} dBFS, noise ${a.noise.toFixed(0)} dBFS.`} Keep the mic at {s.dist} and the Wave XLR gain unchanged.
        </Typography>
      )}
      {s.chain?.length > 0 && <ChainRow chain={s.chain} />}
      {s.noiseReduction && <NoiseReductionCard plan={s.noiseReduction} tag={tagOf(s, s.noiseReduction.plugin)} />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plugins(s).map((p) => <PluginCard key={p.name} {...p} />)}
      </div>
      <Typography variant="body2" color="text.secondary">
        Values are a starting point: about 70% of the measured correction, so they don't overshoot. Type them into each
        plugin window (Wave Link → mic → Effects → the sliders icon), or close Wave Link and run{' '}
        <Box component="code" sx={{ color: 'text.primary' }}>python tools/apply-reaplugs.py reaplugs-settings.json --write</Box>{' '}
        (see tools/README.md). Record a processed take afterwards to check.
      </Typography>
    </Paper>
  )
}

/** ReaPlugs settings built from the raw take (prototype renderSuggest). Hidden without a suggestion. */
export function SuggestedSettings() {
  const s = useSuggestion()
  return s ? <SettingsPanel s={s} /> : null
}
