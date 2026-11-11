import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { EngineInfo } from '../../desktop/types'
import { useEngineInfo } from './useEngineInfo'

/** One small line with the engine's version, Rust, system and architecture. */
export function EngineFooter({ load }: { load: () => Promise<EngineInfo> }) {
  const { t } = useTranslation()
  const state = useEngineInfo(load)
  return (
    <Typography variant="caption" color="text.secondary" component="p" aria-label={t('desktop.info.label')} data-testid="engine-footer">
      {state.status === 'loading' && t('desktop.loading')}
      {state.status === 'error' && t('desktop.error', { message: state.message })}
      {state.status === 'ready' &&
        [
          `${t('desktop.info.appVersion')} ${state.info.appVersion}`,
          `${t('desktop.info.rustVersion')} ${state.info.rustVersion ?? t('desktop.unknown')}`,
          `${t('desktop.info.os')} ${state.info.os}`,
          `${t('desktop.info.arch')} ${state.info.arch}`,
        ].join(' · ')}
    </Typography>
  )
}
