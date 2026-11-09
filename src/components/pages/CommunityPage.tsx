import { useMemo, useState } from 'react'
import SearchIcon from '@mui/icons-material/Search'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { CommunityHowToShare } from './CommunityHowToShare'
import { CommunityMicList } from './CommunityMicList'
import { filterMics, fmtGenerated } from './communityFormat'
import { PageColumn, PageHead, StartButton } from './PageLayout'
import { useCommunityIndexStatus } from './useCommunityIndexStatus'

function EmptyState() {
  return (
    <Paper className="grid justify-items-center gap-3 p-6 text-center">
      <Typography sx={{ fontWeight: 700 }}>No shared results yet — be the first</Typography>
      <StartButton label="Start the check →" />
    </Paper>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-3 py-8" role="status">
      <CircularProgress size={22} />
      <Typography color="text.secondary">Loading shared results…</Typography>
    </div>
  )
}

/** Community page: shared results per mic model, built from public GitHub issues. */
export function CommunityPage() {
  const state = useCommunityIndexStatus()
  const [query, setQuery] = useState('')
  const all = state.status === 'ready' ? state.index.mics : null
  const mics = useMemo(() => (all ? filterMics(all, query) : []), [all, query])
  const hasAny = !!all && all.some((m) => m.reports > 0)
  const updated = state.status === 'ready' ? fmtGenerated(state.index.generated) : null

  return (
    <PageColumn>
      <PageHead
        first="People with"
        second="your mic"
        lead="Built from results people shared as public GitHub issues: typical numbers per mic model, so you can see what is normal for yours."
      />
      <section className="grid gap-4" aria-label="Shared results">
        {state.status === 'loading' && <Loading />}
        {state.status !== 'loading' && !hasAny && <EmptyState />}
        {hasAny && (
          <>
            <TextField
              label="Search mic model"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              fullWidth
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                },
              }}
            />
            {mics.length ? (
              <CommunityMicList mics={mics} />
            ) : (
              <Typography color="text.secondary" align="center">
                No mic matches "{query.trim()}".
              </Typography>
            )}
          </>
        )}
        {updated && (
          <Typography variant="body2" color="text.secondary" align="right">
            Last updated {updated}
          </Typography>
        )}
      </section>
      <CommunityHowToShare />
    </PageColumn>
  )
}
