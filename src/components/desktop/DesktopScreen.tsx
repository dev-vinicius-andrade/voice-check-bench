import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { engineInfo } from '../../desktop/bridge'
import type { EngineInfo } from '../../desktop/types'
import { DefList } from '../pages/DefList'
import { PageColumn } from '../pages/PageLayout'
import { useEngineInfo } from './useEngineInfo'

/** Route #/desktop, shown only inside the desktop app: engine info from the Rust side and what comes next. */
export function DesktopScreen({ load = engineInfo }: { load?: () => Promise<EngineInfo> }) {
  const { t } = useTranslation()
  const state = useEngineInfo(load)
  return (
    <PageColumn>
      <header className="grid gap-2">
        <Typography variant="h3" component="h1">
          {t('desktop.title')}
        </Typography>
        <Typography color="text.secondary">{t('desktop.coming')}</Typography>
      </header>
      <section className="grid gap-3" aria-label={t('desktop.info.label')}>
        {state.status === 'loading' && <Typography color="text.secondary">{t('desktop.loading')}</Typography>}
        {state.status === 'error' && <Alert severity="error">{t('desktop.error', { message: state.message })}</Alert>}
        {state.status === 'ready' && (
          <DefList
            items={[
              { term: t('desktop.info.appVersion'), def: state.info.appVersion },
              { term: t('desktop.info.rustVersion'), def: state.info.rustVersion ?? t('desktop.unknown') },
              { term: t('desktop.info.os'), def: state.info.os },
              { term: t('desktop.info.arch'), def: state.info.arch },
            ]}
          />
        )}
      </section>
    </PageColumn>
  )
}
