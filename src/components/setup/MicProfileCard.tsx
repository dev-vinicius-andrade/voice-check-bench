import Autocomplete from '@mui/material/Autocomplete'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { MIC_CATALOG, addressTip, placementTip } from '../../mics/catalog'
import { useBench } from '../../store/benchStore'
import { useMicProfile } from '../../store/hooks'
import type { MicAddress, MicKind, MicPattern, MicProfile } from '../../types'

const MODELS = [...MIC_CATALOG.map((m) => m.model), 'Other']

const KINDS: [MicKind, string][] = [
  ['dynamic', 'Dynamic'],
  ['condenser', 'Condenser'],
  ['unknown', 'Not sure'],
]
const PATTERNS: [MicPattern, string][] = [
  ['cardioid', 'Cardioid'],
  ['supercardioid', 'Supercardioid'],
  ['omni', 'Omni'],
  ['figure8', 'Figure-8'],
  ['unknown', 'Not sure'],
]
const ADDRESSES: [MicAddress, string][] = [
  ['end', 'Top'],
  ['side', 'Side'],
  ['unknown', 'Not sure'],
]

interface TraitSelectProps<T extends string> {
  label: string
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}

function TraitSelect<T extends string>({ label, value, options, onChange }: TraitSelectProps<T>) {
  return (
    <TextField
      select
      size="small"
      fullWidth
      label={label}
      value={value}
      onChange={(e) => onChange(options.find(([v]) => v === e.target.value)?.[0] ?? value)}
      sx={{ minWidth: 0 }}
    >
      {options.map(([v, text]) => (
        <MenuItem key={v} value={v}>
          {text}
        </MenuItem>
      ))}
    </TextField>
  )
}

/** "Your microphone": model (with suggestions) and the traits that change the advice; saved in this browser. */
export function MicProfileCard() {
  const mic = useMicProfile()
  const setMicProfile = useBench((s) => s.setMicProfile)
  const patch = (p: Partial<MicProfile>): void => setMicProfile(p)

  return (
    <Paper className="grid gap-4 p-4 sm:p-5">
      <div className="grid justify-items-center gap-2 text-center">
        <Typography sx={{ fontWeight: 700 }}>Your microphone</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '56ch' }}>
          Pick your model or type it. Known models fill in the rest; change anything that doesn't match.
        </Typography>
      </div>
      <Autocomplete
        freeSolo
        options={MODELS}
        value={mic.model || null}
        inputValue={mic.model}
        onChange={(_e, v) => patch({ model: v ?? '' })}
        onInputChange={(_e, v) => patch({ model: v })}
        renderInput={(params) => <TextField {...params} size="small" label="Model" />}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <TraitSelect label="Type" value={mic.kind} options={KINDS} onChange={(kind) => patch({ kind })} />
        <TraitSelect label="Pattern" value={mic.pattern} options={PATTERNS} onChange={(pattern) => patch({ pattern })} />
        <TraitSelect
          label="Where you speak"
          value={mic.address}
          options={ADDRESSES}
          onChange={(address) => patch({ address })}
        />
      </div>
      <Typography variant="body2" color="text.secondary">
        {addressTip(mic)} {placementTip(mic)}
      </Typography>
    </Paper>
  )
}
