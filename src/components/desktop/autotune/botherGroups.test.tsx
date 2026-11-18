import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { useState } from 'react'
import i18n from '../../../i18n'
import en from '../../../i18n/locales/en/desktop.json'
import pt from '../../../i18n/locales/pt-BR/desktop.json'
import { BOTHER_GROUPS, BOTHERS, DEFAULT_TUNE_GOALS } from '../../../desktop/autotune/goals'
import type { TuneGoals } from '../../../desktop/tune'
import { theme } from '../../../theme'
import { AdjustPanel } from './AdjustPanel'
import { GoalsStep } from './GoalsStep'

const U = en.desktop.autotune.ui

beforeAll(() => i18n.changeLanguage('en'))
afterEach(cleanup)

function Goals({ onChange }: { onChange: (g: TuneGoals) => void }) {
  const [goals, set] = useState<TuneGoals>(DEFAULT_TUNE_GOALS)
  const setGoals = (patch: Partial<TuneGoals>): void => {
    const next = { ...goals, ...patch }
    set(next)
    onChange(next)
  }
  return <GoalsStep goals={{ goals, setGoals }} onTune={() => undefined} onBack={() => undefined} />
}

const wrap = (node: React.ReactNode) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>)
const chipNames = (group: HTMLElement): string[] => within(group).getAllByRole('button').map((b) => b.textContent ?? '')

describe('what bothers you, grouped', () => {
  it('the goals step shows the four groups under their headings, each a labelled group of its chips', () => {
    wrap(<Goals onChange={() => undefined} />)
    const section = screen.getByRole('region', { name: U.goals.bothers })
    for (const g of BOTHER_GROUPS) {
      const group = within(section).getByRole('group', { name: U.goals.groups[g.id] })
      expect(chipNames(group)).toEqual(g.bothers.map((b) => U.goals.bother[b]))
    }
    expect(within(section).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Noise', 'Tone', 'Volume', 'Processing'])
    // every complaint is offered exactly once
    expect(within(section).getAllByRole('button')).toHaveLength(BOTHERS.length)
  })

  it('a chip toggles with the keyboard and says whether it is picked', () => {
    const onChange = vi.fn()
    wrap(<Goals onChange={onChange} />)
    const chip = screen.getByRole('button', { name: U.goals.bother.metallic })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    chip.focus()
    expect(document.activeElement).toBe(chip)
    fireEvent.keyUp(chip, { key: ' ' })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ bothers: ['metallic'] }))
    expect(screen.getByRole('button', { name: U.goals.bother.metallic }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: U.goals.bother.hum }))
    // kept in the screen's order, whatever order they were picked in
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ bothers: ['hum', 'metallic'] }))
  })

  it('the adjust panel has the same groups, with Too processed first under processing', () => {
    const onRetune = vi.fn()
    wrap(<AdjustPanel onRetune={onRetune} onCancel={() => undefined} />)
    const processing = screen.getByRole('group', { name: U.goals.groups.processing })
    expect(chipNames(processing)).toEqual([U.result.tooProcessed, U.goals.bother.wordsCut, U.goals.bother.metallic])
    for (const g of BOTHER_GROUPS.filter((x) => x.id !== 'processing')) expect(chipNames(screen.getByRole('group', { name: U.goals.groups[g.id] }))).toEqual(g.bothers.map((b) => U.goals.bother[b]))
    fireEvent.click(within(processing).getByRole('button', { name: U.goals.bother.wordsCut }))
    fireEvent.click(screen.getByRole('button', { name: U.goals.bother.hiss }))
    fireEvent.click(screen.getByRole('button', { name: U.result.retune }))
    expect(onRetune).toHaveBeenCalledWith(['hiss', 'wordsCut'])
    // Too processed is one or the other
    fireEvent.click(within(processing).getByRole('button', { name: U.result.tooProcessed }))
    expect(within(processing).getByRole('button', { name: U.goals.bother.wordsCut }).getAttribute('aria-pressed')).toBe('false')
  })

  it('every complaint and group has its words in English and Portuguese', () => {
    for (const ui of [U, pt.desktop.autotune.ui]) {
      for (const b of BOTHERS) expect(ui.goals.bother[b], b).toBeTruthy()
      for (const g of BOTHER_GROUPS) expect(ui.goals.groups[g.id], g.id).toBeTruthy()
    }
    expect(pt.desktop.autotune.ui.goals.bother.wordsCut).toBe('Palavras cortadas')
    expect(pt.desktop.autotune.ui.goals.bother.hiss).toBe('Chiado agudo')
  })
})
