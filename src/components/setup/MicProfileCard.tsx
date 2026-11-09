import Autocomplete from '@mui/material/Autocomplete'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { MAINS_SETTINGS } from '../../audio/mains'
import { MIC_CATALOG, MIC_OTHER_LABEL } from '../../mics/catalog'
import { useBench } from '../../store/benchStore'
import { useMicProfile } from '../../store/hooks'
import type { MicProfile } from '../../types'
import { useMsg } from '../common/MsgText'
import { CommunityMicLine } from './CommunityMicLine'
import { MicTips } from './MicTips'
import { ADDRESSES, KINDS, PATTERNS } from './micOptions'

/** Option id for "Other / not listed": never stored (picking it stores model ''), shown translated. */
const OTHER = '__other__'
const MODELS = [...MIC_CATALOG.map((m) => m.model), OTHER]

interface TraitSelectProps<T extends string> {
  /** wizard.mic.<group>: option labels under <group>.<value>, explanations under <group>Help.<value>. */
  group: 'kind' | 'pattern' | 'address'
  value: T
  options: readonly T[]
  onChange: (v: T) => void
}

function TraitSelect<T extends string>({ group, value, options, onChange }: TraitSelectProps<T>) {
  const { t } = useTranslation()
  const optionKey = (v: string): string => `wizard.mic.${group}.${v}`
  const helpKey: string = `wizard.mic.${group}Help.${value}`
  return (
    <TextField
      select
      size="small"
      fullWidth
      label={t(`wizard.mic.${group}Label`)}
      value={value}
      onChange={(e) => onChange(options.find((v) => v === e.target.value) ?? value)}
      helperText={t(helpKey)}
      sx={{ minWidth: 0 }}
    >
      {options.map((v) => (
        <MenuItem key={v} value={v}>
          {t(optionKey(v))}
        </MenuItem>
      ))}
    </TextField>
  )
}

/** "Power in your country": 50 Hz / 60 Hz / Auto (from the locale region); the hum check listens for it. */
function MainsSelect() {
  const { t } = useTranslation()
  const mains = useBench((s) => s.mains)
  const setMains = useBench((s) => s.setMains)
  return (
    <TextField
      select
      size="small"
      label={t('engine.mic.mains.label')}
      value={mains}
      onChange={(e) => setMains(MAINS_SETTINGS.find((m) => String(m) === e.target.value) ?? mains)}
      sx={{ minWidth: 0, maxWidth: 260 }}
    >
      {MAINS_SETTINGS.map((m) => (
        <MenuItem key={m} value={m}>
          {m === 'auto' ? t('engine.mic.mains.auto') : t('engine.mic.mains.hz', { hz: m })}
        </MenuItem>
      ))}
    </TextField>
  )
}

/** "Which mic do you have?": model (with suggestions) and plain-language traits that change the advice; saved in this browser. */
export function MicProfileCard() {
  const { t } = useTranslation()
  const tm = useMsg()
  const mic = useMicProfile()
  const setMicProfile = useBench((s) => s.setMicProfile)
  const patch = (p: Partial<MicProfile>): void => setMicProfile(p)

  return (
    <Paper className="grid gap-4 p-4 sm:p-5">
      <div className="grid justify-items-center gap-2 text-center">
        <Typography sx={{ fontWeight: 700 }}>{t('wizard.mic.title')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '56ch' }}>
          {t('wizard.mic.lead')}
        </Typography>
      </div>
      <Autocomplete
        freeSolo
        options={MODELS}
        getOptionLabel={(o) => (o === OTHER ? tm(MIC_OTHER_LABEL) : o)}
        value={mic.model || null}
        inputValue={mic.model}
        onChange={(_e, v) => patch({ model: !v || v === OTHER ? '' : v })}
        // typing and clearing only: on 'reset' the input would receive the option's (translated) label
        onInputChange={(_e, v, reason) => {
          if (reason === 'input' || reason === 'clear') patch({ model: v })
        }}
        renderInput={(params) => <TextField {...params} size="small" label={t('wizard.mic.model')} />}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TraitSelect group="kind" value={mic.kind} options={KINDS} onChange={(kind) => patch({ kind })} />
        <TraitSelect group="pattern" value={mic.pattern} options={PATTERNS} onChange={(pattern) => patch({ pattern })} />
        <TraitSelect group="address" value={mic.address} options={ADDRESSES} onChange={(address) => patch({ address })} />
      </div>
      <MainsSelect />
      <Typography variant="body2" color="text.secondary">
        <MicTips />
      </Typography>
      <CommunityMicLine model={mic.model} />
    </Paper>
  )
}
