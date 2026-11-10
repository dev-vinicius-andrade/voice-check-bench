import { useState } from 'react'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { SolutionItem } from '../../community/solutions'
import type { CommunityMicStats } from '../../community/types'
import { useSuggestion } from '../../store/hooks'
import { HOW_TO_SHARE_ID } from './howItWorksData'
import { SolutionCard } from './SolutionCard'
import { SolutionFilters } from './SolutionFilters'
import { useSolutionFilter } from './useSolutionFilter'

const PAGE = 10

/** Up to 10 cards, "Show more" adds 10. Remounted (back to 10) when the filter changes. */
function SolutionList({ items, showMic }: { items: readonly SolutionItem[]; showMic: boolean }) {
  const { t } = useTranslation()
  const canUse = useSuggestion() !== null
  const [shown, setShown] = useState(PAGE)
  return (
    <>
      <ul className="m-0 grid list-none gap-3 p-0" aria-label={t('pages.community.solutions.listLabel')}>
        {items.slice(0, shown).map((s) => (
          <SolutionCard key={s.issue} s={s} model={showMic ? s.model : undefined} canUse={canUse} />
        ))}
      </ul>
      {items.length > shown && (
        <Button variant="outlined" className="justify-self-center" onClick={() => setShown((n) => n + PAGE)}>
          {t('pages.community.solutions.more', { count: items.length - shown })}
        </Button>
      )}
    </>
  )
}

function NoneShared() {
  const { t } = useTranslation()
  const toHowTo = (): void => document.getElementById(HOW_TO_SHARE_ID)?.scrollIntoView({ behavior: 'smooth' })
  return (
    <Typography color="text.secondary" data-testid="solutions-none">
      {t('pages.community.solutions.none')}{' '}
      <Link component="button" type="button" onClick={toHowTo} sx={{ verticalAlign: 'baseline' }}>
        {t('pages.community.solutions.howTo')}
      </Link>
    </Typography>
  )
}

/** "Shared settings": people's settings for their mic, ranked by 👍 on GitHub, with filters. */
export function SolutionsSection({ mics }: { mics: readonly CommunityMicStats[] }) {
  const { t } = useTranslation()
  const state = useSolutionFilter(mics)
  return (
    <section className="grid gap-4" aria-labelledby="solutions-title" data-testid="solutions">
      <div className="grid gap-1">
        <Typography id="solutions-title" variant="h6" component="h2" sx={{ textTransform: 'uppercase' }}>
          {t('pages.community.solutions.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">{t('pages.community.solutions.intro')}</Typography>
      </div>
      {state.total === 0 && <NoneShared />}
      {state.total > 0 && <SolutionFilters state={state} />}
      {state.total > 0 && state.items.length === 0 && (
        <div className="grid justify-items-center gap-2 text-center" data-testid="solutions-no-match">
          <Typography color="text.secondary">{t('pages.community.solutions.noMatch')}</Typography>
          <Button size="small" onClick={state.clear}>{t('pages.community.solutions.clear')}</Button>
        </div>
      )}
      {state.items.length > 0 && (
        <SolutionList key={JSON.stringify(state.filter)} items={state.items} showMic={state.filter.mic === 'all'} />
      )}
    </section>
  )
}
