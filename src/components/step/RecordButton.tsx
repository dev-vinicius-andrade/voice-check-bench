import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'

interface RecordButtonProps {
  /** A take already exists for this step (label becomes "Record again"). */
  hasTake: boolean
}

/** Big round record button: red dot, rounded square while recording. */
export function RecordButton({ hasTake }: RecordButtonProps) {
  const { t } = useTranslation()
  const phase = useBench((s) => s.recorder.phase)
  const micOn = useBench((s) => s.mic.status === 'on')
  const toggleRecording = useBench((s) => s.toggleRecording)
  const recording = phase === 'silence' || phase === 'reading'
  const label = t(recording ? 'wizard.record.stop' : hasTake ? 'wizard.record.again' : 'wizard.record.start')

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <IconButton
        aria-label={label}
        data-record-button
        onClick={toggleRecording}
        disabled={!micOn || phase === 'analyzing'}
        sx={{
          width: 88,
          height: 88,
          border: 4,
          borderColor: recording ? 'error.main' : 'divider',
          bgcolor: 'background.paper',
          '&.Mui-disabled': { opacity: 0.35, borderColor: 'divider' },
        }}
      >
        <Box
          component="span"
          sx={{
            display: 'block',
            width: recording ? 28 : 34,
            height: recording ? 28 : 34,
            borderRadius: recording ? '6px' : '50%',
            bgcolor: 'error.main',
            transition: 'border-radius .15s, width .15s, height .15s',
          }}
        />
      </IconButton>
      <Typography variant="body2" color="text.secondary">
        <Box component="kbd" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 0.75, fontFamily: 'inherit' }}>
          {t('wizard.record.key')}
        </Box>{' '}
        {t('wizard.record.keyHint')}
      </Typography>
    </div>
  )
}
