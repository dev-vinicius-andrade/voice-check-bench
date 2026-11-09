// "What do you use for your mic?": host cards, a short chooser for "Not sure", and a compact line once picked.
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { HOSTS, type Host } from './hostPref'

interface HostPickerProps {
  host: Host | null
  onPick: (h: Host | null) => void
}

const RECOMMEND: readonly Host[] = ['wavelink', 'obs', 'apps']

function UnsureHelp({ onPick }: { onPick: (h: Host) => void }) {
  const { t } = useTranslation()
  return (
    <Paper variant="outlined" className="grid gap-2 p-4" data-testid="host-unsure">
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>{t('guide.host.unsure.title')}</Typography>
      <Typography color="text.secondary">{t('guide.host.unsure.text')}</Typography>
      <ul className="m-0 grid gap-2 pl-5">
        {RECOMMEND.map((h) => (
          <li key={h}>
            <Typography>{t(`guide.host.unsure.${h}`)}</Typography>
            <Button size="small" onClick={() => onPick(h)}>
              {t('guide.host.unsure.pick', { name: t(`guide.host.option.${h}.name`) })}
            </Button>
          </li>
        ))}
      </ul>
    </Paper>
  )
}

export function HostPicker({ host, onPick }: HostPickerProps) {
  const { t } = useTranslation()
  if (host && host !== 'unsure') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Typography sx={{ fontWeight: 600 }}>{t('guide.host.picked', { name: t(`guide.host.option.${host}.name`) })}</Typography>
        <Button size="small" variant="outlined" onClick={() => onPick(null)}>{t('guide.host.change')}</Button>
      </div>
    )
  }
  return (
    <section aria-labelledby="host-question" className="grid gap-3">
      <div className="grid gap-1">
        <Typography id="host-question" variant="h6" component="h2">{t('guide.host.question')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('guide.host.hint')}</Typography>
      </div>
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby="host-question">
        {HOSTS.map((h) => (
          <Card key={h} variant="outlined" sx={{ borderColor: host === h ? 'primary.main' : undefined, borderWidth: host === h ? 2 : undefined }}>
            <CardActionArea role="radio" aria-checked={host === h} onClick={() => onPick(h)} className="h-full" sx={{ p: 2 }}>
              <Typography sx={{ fontWeight: 700 }}>{t(`guide.host.option.${h}.name`)}</Typography>
              <Typography variant="body2" color="text.secondary">{t(`guide.host.option.${h}.text`)}</Typography>
            </CardActionArea>
          </Card>
        ))}
      </div>
      {host === 'unsure' && <UnsureHelp onPick={onPick} />}
    </section>
  )
}
