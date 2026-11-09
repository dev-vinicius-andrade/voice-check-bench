import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import ToggleButton from '@mui/material/ToggleButton'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import DownloadIcon from '@mui/icons-material/Download'
import { downloadTakeWav } from './download'
import { useBench } from '../../store/benchStore'
import { isAnalysisError, type Take } from '../../types'

const meta = (t: Take): string =>
  isAnalysisError(t.analysis)
    ? `${(t.samples.length / t.sampleRate).toFixed(1)} s · not analyzed`
    : `speech ${t.analysis.speechMed.toFixed(1)} · noise ${t.analysis.noise.toFixed(0)} dBFS`

const btnSx = { px: 1, py: 0.25, minWidth: 0, lineHeight: 1.4 }

/** One take in the side panel: name, levels, A/B toggles, play, delete (prototype renderTakes). */
export function TakeRow({ take }: { take: Take }) {
  const isA = useBench((s) => s.A === take.id)
  const isB = useBench((s) => s.B === take.id)
  const setA = useBench((s) => s.setA)
  const toggleB = useBench((s) => s.toggleB)
  const playTake = useBench((s) => s.playTake)
  const deleteTake = useBench((s) => s.deleteTake)

  return (
    <Paper
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5"
      sx={{ borderColor: isA ? 'primary.main' : isB ? 'info.main' : undefined }}
    >
      <div className="min-w-0">
        <Typography variant="body2" noWrap title={take.name} sx={{ fontWeight: 600 }}>{take.name}</Typography>
        <Typography variant="caption" color="text.secondary" component="div" noWrap>{meta(take)}</Typography>
      </div>
      <div className="flex items-center gap-1">
        <ToggleButton value="A" size="small" color="primary" selected={isA} title="Show as A" sx={btnSx} onChange={() => setA(take.id)}>
          A
        </ToggleButton>
        <ToggleButton value="B" size="small" color="info" selected={isB} title="Compare as B" sx={btnSx} onChange={() => toggleB(take.id)}>
          B
        </ToggleButton>
        <IconButton size="small" title="Play" aria-label={`Play ${take.name}`} onClick={() => playTake(take.id)}>
          <PlayArrowIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" title="Download WAV" aria-label={`Download ${take.name} as WAV`} onClick={() => downloadTakeWav(take)}>
          <DownloadIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" title="Delete take" aria-label={`Delete ${take.name}`} onClick={() => deleteTake(take.id)}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </div>
    </Paper>
  )
}
