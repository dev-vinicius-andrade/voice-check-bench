import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { fakeAnalysis } from '../../audio/testSignals'
import i18n from '../../i18n'
import { mic, noisyAnalysis, processedPair } from '../../plain/testFixtures'
import { profileFromSession } from '../../profiles/build'
import { openProfilesStore } from '../../profiles/store'
import { useBench } from '../../store/benchStore'
import { theme } from '../../theme'
import { suggestionFixture } from '../../wavelink/testFixtures'
import { ProfilesPage } from './ProfilesPage'
import { SaveProfileButton } from './SaveProfileButton'
import { saveGate } from './useSaveProfile'

vi.mock('../../storage/takesDb', async (orig) => ({
  ...(await orig<typeof import('../../storage/takesDb')>()),
  openAppDb: async () => {
    throw new Error('no IndexedDB in tests')
  },
}))

const goal = { style: 'warm' as const, perceived: [] }
const seed = (id: string, name: string, validated = false) =>
  profileFromSession({
    id,
    name,
    now: new Date('2026-11-01T10:00:00Z'),
    mic: mic(),
    host: 'obs',
    dist: '8 cm',
    goal,
    mains: 50,
    suggestion: suggestionFixture(),
    raw: validated ? noisyAnalysis() : null,
    fx: validated ? fakeAnalysis() : null,
  })

const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
const cards = () => screen.queryAllByRole('article')

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(async () => {
  const s = await openProfilesStore()
  for (const p of await s.list()) await s.delete(p.id)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProfilesPage', () => {
  it('explains profiles when there are none', async () => {
    wrap(<ProfilesPage />)
    expect(await screen.findByText('No profiles yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start a check' })).toBeTruthy()
  })

  it('shows cards with chips and supports rename, duplicate, set active and delete', async () => {
    const s = await openProfilesStore()
    await s.put(seed('a', 'Desk', true))
    await s.put(seed('b', 'Draft'))
    wrap(<ProfilesPage />)
    await waitFor(() => expect(cards()).toHaveLength(2))
    const desk = screen.getByRole('article', { name: 'Desk' })
    expect(within(desk).getByText(/^Validated · \d+ → \d+ · /)).toBeTruthy()
    expect(within(desk).getByText('OBS Studio')).toBeTruthy()
    expect(within(screen.getByRole('article', { name: 'Draft' })).getByText('Not validated')).toBeTruthy()

    fireEvent.click(within(desk).getByRole('button', { name: 'Rename' }))
    const dialog = screen.getByRole('dialog', { name: 'Rename profile' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Studio' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const studio = await screen.findByRole('article', { name: 'Studio' })

    fireEvent.click(within(studio).getByRole('button', { name: 'Duplicate' }))
    await screen.findByRole('article', { name: 'Studio (copy)' })
    expect(cards()).toHaveLength(3)

    fireEvent.click(within(studio).getByRole('button', { name: 'Set active' }))
    await waitFor(() => expect(within(screen.getByRole('article', { name: 'Studio' })).getByText('Active')).toBeTruthy())

    const draft = screen.getByRole('article', { name: 'Draft' })
    fireEvent.click(within(draft).getByRole('button', { name: 'Delete' }))
    expect(cards()).toHaveLength(3)
    fireEvent.click(within(draft).getByRole('button', { name: 'Click again to delete' }))
    await waitFor(() => expect(cards()).toHaveLength(2))
    expect((await s.list()).map((p) => p.name).sort()).toEqual(['Studio', 'Studio (copy)'])
  })

  it('re-test sets the goal and goes to the check', async () => {
    await (await openProfilesStore()).put(seed('a', 'Desk'))
    const goTo = vi.fn()
    const setGoal = vi.fn()
    const setStatus = vi.fn()
    useBench.setState({ goTo, setGoal, setStatus })
    wrap(<ProfilesPage />)
    fireEvent.click(within(await screen.findByRole('article', { name: 'Desk' })).getByRole('button', { name: 'Re-test' }))
    expect(setGoal).toHaveBeenCalledWith(goal)
    expect(goTo).toHaveBeenCalledWith('setup')
    expect(setStatus).toHaveBeenCalledWith({ key: 'profiles.retest.status', params: { name: 'Desk', dist: '8 cm' } })
  })
})

describe('save as profile gating', () => {
  it('passes only when processing beats raw without regressions', () => {
    expect(saveGate(null, null, goal)).toEqual({ ok: false, reason: 'noFx' })
    expect(saveGate(noisyAnalysis(), fakeAnalysis(), goal)).toMatchObject({ ok: true, reason: null })
    const { raw, fx } = processedPair()
    expect(saveGate(raw, fx, goal)).toMatchObject({ ok: false, reason: 'regressions' })
    expect(saveGate(fakeAnalysis(), fakeAnalysis(), goal)).toMatchObject({ ok: false, reason: 'gain' })
  })

  it('validated: shows raw → fx and saves with the suggested name', async () => {
    const onSave = vi.fn(async () => undefined)
    wrap(<SaveProfileButton gate={{ ok: true, reason: null, rawScore: 49, fxScore: 71 }} suggestedName="Wave Link · Warm" onSave={onSave} />)
    expect(screen.getByText('Validated · 49 → 71')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save as profile' }))
    const dialog = screen.getByRole('dialog', { name: 'Save as profile' })
    expect((within(dialog).getByLabelText('Profile name') as HTMLInputElement).value).toBe('Wave Link · Warm')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Wave Link · Warm'))
    expect(await screen.findByText('Saved as profile "Wave Link · Warm".')).toBeTruthy()
  })

  it('not validated: explains why and offers "Save anyway"', async () => {
    const onSave = vi.fn(async () => undefined)
    wrap(<SaveProfileButton gate={{ ok: false, reason: 'gain', rawScore: 60, fxScore: 62 }} suggestedName="Warm" onSave={onSave} />)
    const button = screen.getByRole('button', { name: 'Save as profile' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText("Your effects didn't improve the sound yet: fix that first.")).toBeTruthy()
    expect(screen.getByText(/With effects you scored 62, without 60/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway as not validated' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Warm'))
  })
})
