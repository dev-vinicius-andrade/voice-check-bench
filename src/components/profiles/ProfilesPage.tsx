import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { importProfile } from '../../profiles/build'
import { useBench } from '../../store/benchStore'
import { PageColumn, PageHead } from '../pages/PageLayout'
import { ProfileCard } from './ProfileCard'
import { useProfiles, type ProfilesApi } from './useProfiles'

type ImportNote = { ok: true; name: string } | { ok: false } | null

function ImportButton({ api, onDone }: { api: ProfilesApi; onDone(n: ImportNote): void }) {
  const { t } = useTranslation()
  const load = async (f: File): Promise<void> => {
    try {
      const p = importProfile(await f.text())
      if (!p) throw new Error('invalid')
      await api.put(p)
      onDone({ ok: true, name: p.name })
    } catch {
      onDone({ ok: false })
    }
  }
  return (
    <Button variant="outlined" component="label">
      {t('profiles.import.button')}
      <input
        hidden
        type="file"
        accept=".json,application/json"
        aria-label={t('profiles.import.button')}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void load(f)
          e.target.value = ''
        }}
      />
    </Button>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  const goTo = useBench((s) => s.goTo)
  return (
    <Paper variant="outlined" className="grid justify-items-start gap-2 p-4">
      <Typography variant="h6" component="h2">{t('profiles.empty.title')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('profiles.empty.text')}</Typography>
      <Button variant="contained" onClick={() => goTo('setup')}>{t('profiles.empty.start')}</Button>
    </Paper>
  )
}

/** Route #/profiles: saved profiles as cards, import, empty state. */
export function ProfilesPage() {
  const { t } = useTranslation()
  const api = useProfiles()
  const [note, setNote] = useState<ImportNote>(null)
  return (
    <PageColumn>
      <PageHead first={t('profiles.page.first')} second={t('profiles.page.second')} lead={t('profiles.page.lead')} />
      <div className="grid gap-4">
        <div className="flex flex-wrap justify-end gap-2">
          <ImportButton api={api} onDone={setNote} />
        </div>
        {note && (
          <Alert severity={note.ok ? 'success' : 'error'} onClose={() => setNote(null)}>
            {note.ok ? t('profiles.import.done', { name: note.name }) : t('profiles.import.error')}
          </Alert>
        )}
        {api.profiles?.length === 0 && <EmptyState />}
        {api.profiles?.map((p) => <ProfileCard key={p.id} p={p} api={api} />)}
      </div>
    </PageColumn>
  )
}
