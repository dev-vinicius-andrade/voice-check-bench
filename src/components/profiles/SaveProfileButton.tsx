import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { PROFILE_MIN_GAIN } from '../../profiles/types'
import { useBench } from '../../store/benchStore'
import { NameDialog } from './NameDialog'
import type { SaveGate } from './useSaveProfile'

/** Why saving is not validated yet, in plain words. */
function WhyNot({ gate }: { gate: SaveGate }) {
  const { t } = useTranslation()
  const goTo = useBench((s) => s.goTo)
  const detail =
    gate.reason === 'noFx'
      ? t('profiles.save.noFx')
      : gate.reason === 'regressions'
        ? t('profiles.save.regressions')
        : t('profiles.save.gain', { raw: gate.rawScore ?? 0, fx: gate.fxScore ?? 0, min: PROFILE_MIN_GAIN })
  return (
    <Alert severity="warning" className="text-left" action={<Button size="small" color="inherit" onClick={() => goTo('guide')}>{t('profiles.save.openGuide')}</Button>}>
      <div className="grid gap-1">
        <span>{t('profiles.save.notYet')}</span>
        <span>{detail}</span>
      </div>
    </Alert>
  )
}

export interface SaveProfileButtonProps {
  gate: SaveGate
  suggestedName: string
  /** Saves the profile (validated only when the gate passes). */
  onSave(name: string): Promise<void>
}

/** "Save as profile": validated when the processed take beats the raw one; otherwise explains why, with "save anyway". */
export function SaveProfileButton({ gate, suggestedName, onSave }: SaveProfileButtonProps) {
  const { t } = useTranslation()
  const goTo = useBench((s) => s.goTo)
  const [why, setWhy] = useState(false)
  const [dialog, setDialog] = useState<'validated' | 'draft' | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const save = async (name: string): Promise<void> => {
    setDialog(null)
    await onSave(name)
    setSaved(name)
    setWhy(false)
  }
  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {gate.ok && gate.rawScore !== undefined && gate.fxScore !== undefined && (
          <Typography variant="caption" color="success.main">
            {t('profiles.save.validated', { raw: gate.rawScore, fx: gate.fxScore })}
          </Typography>
        )}
        <Button
          variant={gate.ok ? 'contained' : 'outlined'}
          color={gate.ok ? 'primary' : 'inherit'}
          aria-disabled={!gate.ok}
          sx={gate.ok ? undefined : { color: 'text.disabled' }}
          onClick={() => (gate.ok ? setDialog('validated') : setWhy(true))}
        >
          {t('profiles.save.button')}
        </Button>
      </div>
      {why && !gate.ok && (
        <>
          <WhyNot gate={gate} />
          <Button size="small" variant="outlined" onClick={() => setDialog('draft')}>{t('profiles.save.anyway')}</Button>
        </>
      )}
      {saved && (
        <Alert severity="success" action={<Button size="small" color="inherit" onClick={() => goTo('profiles')}>{t('profiles.save.seeProfiles')}</Button>}>
          {t('profiles.save.saved', { name: saved })}
        </Alert>
      )}
      <NameDialog
        open={dialog !== null}
        title={t('profiles.save.dialogTitle')}
        label={t('profiles.save.nameLabel')}
        confirm={t('profiles.save.confirm')}
        cancel={t('profiles.save.cancel')}
        initial={suggestedName}
        onClose={() => setDialog(null)}
        onConfirm={(name) => void save(name)}
      />
    </div>
  )
}
