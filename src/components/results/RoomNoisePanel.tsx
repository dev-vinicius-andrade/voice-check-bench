import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import type { Analysis } from '../../types'
import { BandSnrChart } from './BandSnrChart'
import { NOISE_KIND_LABEL, fmtHz, hasBandSnr } from './roomNoise'

/** Room noise of take A: level and kind, steady tones, and how far the voice beats the room per octave. */
export function RoomNoisePanel({ a }: { a: Analysis }) {
  const kind = a.noiseKind ? NOISE_KIND_LABEL[a.noiseKind] : null
  const tones = a.tones ?? []
  const bands = hasBandSnr(a)
  return (
    <section aria-label="Room noise" className="grid gap-2">
      <div>
        <Typography variant="h6" component="h2">Room noise</Typography>
        <Typography variant="body2" color="text.secondary">
          {a.noiseFromQuiet ? 'Measured in the silent seconds before you read.' : 'Estimated from the quietest moments of the take.'}
          {bands && ' Bars show how far your voice is above the room in each octave: under 10 dB the noise wins, 20 dB and up is clear.'}
        </Typography>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          Noise floor <b>{a.noise.toFixed(1)}</b> dBFS
        </Typography>
        {kind && (
          <Chip size="small" label={kind} color={a.noiseKind === 'quiet' ? 'success' : 'warning'} variant="outlined" />
        )}
      </div>
      {tones.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Typography variant="caption" color="text.secondary">Steady tones:</Typography>
          {tones.map((t) => (
            <Chip key={t.hz} size="small" label={`${fmtHz(t.hz)} +${t.db.toFixed(0)} dB`} />
          ))}
        </div>
      )}
      {bands && (
        <div className="overflow-x-auto">
          <BandSnrChart snr={a.bandSnr} />
        </div>
      )}
    </section>
  )
}
