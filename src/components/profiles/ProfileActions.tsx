import { useCallback, useState } from 'react'
import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { duplicateProfile, exportProfile, profilePlan } from '../../profiles/build'
import type { Profile } from '../../profiles/types'
import type { WlFile } from '../../wavelink/types'
import { useBench } from '../../store/benchStore'
import { downloadFile } from '../results/download'
import { WaveLinkApplyDialog } from '../wavelink/WaveLinkApplyDialog'
import { CaptureDialog } from './CaptureDialog'
import { NameDialog } from './NameDialog'
import { exportFileName } from './profileFormat'
import type { ProfilesApi } from './useProfiles'

type Open = 'apply' | 'capture' | 'rename' | null

/** Apply · Capture · Re-test · Export · Duplicate · Rename · Set active · Delete (second click confirms). */
export function ProfileActions({ p, api }: { p: Profile; api: ProfilesApi }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<Open>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const close = (): void => setOpen(null)
  const buildPlan = useCallback((file: WlFile, key: string) => profilePlan(p, file, key), [p])
  const stamp = (): string => new Date().toISOString()

  const retest = (): void => {
    const st = useBench.getState()
    st.setGoal(p.goal)
    st.goTo('setup')
    st.setStatus({ key: 'profiles.retest.status', params: { name: p.name, dist: p.dist } })
  }
  const duplicate = (): void => void api.put(duplicateProfile(p, t('profiles.actions.copyName', { name: p.name })))
  const remove = (): void => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    void api.remove(p.id)
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('profiles.actions.label', { name: p.name })}>
      <Button size="small" variant="contained" onClick={() => setOpen('apply')}>{t('profiles.actions.apply')}</Button>
      <Button size="small" variant="outlined" onClick={() => setOpen('capture')}>{t('profiles.actions.capture')}</Button>
      <Button size="small" variant="outlined" onClick={retest}>{t('profiles.actions.retest')}</Button>
      <Button size="small" variant="outlined" onClick={() => downloadFile(exportFileName(p.name), exportProfile(p), 'application/json')}>
        {t('profiles.actions.export')}
      </Button>
      <Button size="small" variant="outlined" onClick={duplicate}>{t('profiles.actions.duplicate')}</Button>
      <Button size="small" variant="outlined" onClick={() => setOpen('rename')}>{t('profiles.actions.rename')}</Button>
      {!p.active && (
        <Button size="small" variant="outlined" onClick={() => void api.setActive(p.id)}>{t('profiles.actions.setActive')}</Button>
      )}
      <Button size="small" variant={confirmDelete ? 'contained' : 'outlined'} color="error" onClick={remove} onBlur={() => setConfirmDelete(false)}>
        {confirmDelete ? t('profiles.actions.confirmDelete') : t('profiles.actions.delete')}
      </Button>
      <WaveLinkApplyDialog open={open === 'apply'} onClose={close} buildPlan={buildPlan} title={`${t('profiles.wl.title')} · ${p.name}`} />
      <CaptureDialog open={open === 'capture'} onClose={close} p={p} onSave={(states) => api.put({ ...p, wavelinkStates: states, updated: stamp() })} />
      <NameDialog
        open={open === 'rename'}
        title={t('profiles.rename.title')}
        label={t('profiles.rename.label')}
        confirm={t('profiles.rename.save')}
        cancel={t('profiles.rename.cancel')}
        initial={p.name}
        onClose={close}
        onConfirm={(name) => {
          close()
          void api.put({ ...p, name, updated: stamp() })
        }}
      />
    </div>
  )
}
