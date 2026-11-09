import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import type { ReactElement } from 'react'
import i18n from '../../../i18n'
import { theme } from '../../../theme'
import type { Suggestion } from '../../../types'
import { ReaCompPanel } from './ReaCompPanel'
import { ReaEqPanel } from './ReaEqPanel'
import { ReaFirPanel } from './ReaFirPanel'
import { ReaGatePanel } from './ReaGatePanel'
import { WaveLinkEffects } from './WaveLinkEffects'

const why = { key: 'engine.suggest.why.top' }
const EQ: Suggestion['eq'] = [
  { type: 'Low Shelf', freq: 150, gain: -4.5, bw: 2, why },
  { type: 'Band', freq: 780, gain: -9, bw: 0.1, why },
  { type: 'High Shelf', freq: 10000, gain: 2, bw: 2, why },
]
const COMP: Suggestion['comp'] = { threshold: -24, ratio: 2.5, attack: 5, release: 100, knee: 6, wet: 3, limit: true }
const GATE: Suggestion['gate'] = { threshold: -52, attack: 1, hold: 150, release: 200, hysteresis: -6, wet: 0, dry: -20 }

const ui = (el: ReactElement) => render(<ThemeProvider theme={theme}>{el}</ThemeProvider>)
const field = (container: HTMLElement, target: string): string =>
  container.querySelector(`[data-target="${target}"] [data-field]`)?.textContent ?? ''
const markers = (container: HTMLElement): Record<string, string> =>
  Object.fromEntries([...container.querySelectorAll('[data-callout]')].map((m) => [m.closest('[data-target]')?.getAttribute('data-target') ?? '', m.textContent ?? '']))

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('ReaEqPanel', () => {
  it('shows one tab per band, the active band values and its node', () => {
    const { container } = ui(<ReaEqPanel eq={EQ} activeBand={1} callouts={[{ n: 1, target: 'tab-2' }, { n: 2, target: 'frequency' }, { n: 3, target: 'nope' }]} />)
    const tabs = screen.getAllByTestId('eq-tab')
    expect(tabs).toHaveLength(EQ.length)
    expect(tabs.map((t) => t.getAttribute('data-selected'))).toEqual(['false', 'true', 'false'])
    expect(field(container, 'frequency')).toBe('780')
    expect(field(container, 'gain')).toBe('-9.0')
    expect(field(container, 'bandwidth')).toBe('0.1')
    expect(container.querySelector('[data-target="type"] [data-value]')?.getAttribute('data-value')).toBe('Band')
    expect(container.querySelectorAll('[data-node]')).toHaveLength(3)
    expect(container.querySelector('[data-node="2"]')?.getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('eq-curve').getAttribute('d')).toMatch(/^M/)
    expect(markers(container)).toEqual({ 'tab-2': '1', frequency: '2' })
    expect(screen.getByText('ReaEQ (ReaPlugs Edition)')).toBeTruthy()
    expect(screen.getByText('Band 3: Type High Shelf, Frequency (Hz) 10000, Gain (dB) 2.0, Bandwidth (oct) 2.0')).toBeTruthy()
  })

  it('uses plugin-typable numbers in pt-BR: no thousands separator, "." decimals', async () => {
    await i18n.changeLanguage('pt-BR')
    const { container } = ui(<ReaEqPanel eq={EQ} activeBand={2} />)
    expect(field(container, 'frequency')).toBe('10000')
    expect(field(container, 'gain')).toBe('2.0')
    expect(container.querySelectorAll('[data-callout]')).toHaveLength(0)
  })

  it('renders with no bands', () => {
    ui(<ReaEqPanel eq={[]} activeBand={0} />)
    expect(screen.queryAllByTestId('eq-tab')).toHaveLength(0)
    expect(screen.getByText('No EQ bands to add.')).toBeTruthy()
  })
})

describe('ReaCompPanel', () => {
  it('shows the values and callouts', () => {
    const { container } = ui(<ReaCompPanel comp={COMP} callouts={[{ n: 1, target: 'threshold' }, { n: 2, target: 'ratio' }]} />)
    expect(field(container, 'threshold')).toBe('-24.0')
    expect(field(container, 'ratio')).toBe('2.5')
    expect(field(container, 'attack')).toBe('5')
    expect(field(container, 'release')).toBe('100')
    expect(field(container, 'knee')).toBe('6.0')
    expect(field(container, 'wet')).toBe('3.0')
    expect(container.querySelector('[data-target="limit"] [data-checked]')?.getAttribute('data-checked')).toBe('true')
    expect(markers(container)).toEqual({ threshold: '1', ratio: '2' })
    expect(screen.getByText(/Threshold -24\.0 dB, Ratio 2\.5:1/)).toBeTruthy()
  })
})

describe('ReaGatePanel', () => {
  it('shows the values and callouts', () => {
    const { container } = ui(<ReaGatePanel gate={GATE} callouts={[{ n: 4, target: 'hold' }]} />)
    expect(field(container, 'threshold')).toBe('-52.0')
    expect(field(container, 'attack')).toBe('1')
    expect(field(container, 'hold')).toBe('150')
    expect(field(container, 'release')).toBe('200')
    expect(field(container, 'hysteresis')).toBe('-6.0')
    expect(field(container, 'wet')).toBe('0.0')
    expect(field(container, 'dry')).toBe('-20.0')
    expect(markers(container)).toEqual({ hold: '4' })
  })
})

describe('ReaFirPanel', () => {
  it('setup highlights Mode = Subtract and FFT size = 4096', () => {
    const { container } = ui(<ReaFirPanel phase="setup" callouts={[{ n: 1, target: 'mode' }, { n: 2, target: 'fftSize' }]} />)
    expect(container.querySelector('[data-target="mode"] [data-value]')?.getAttribute('data-value')).toBe('Subtract')
    expect(container.querySelector('[data-target="fftSize"] [data-value]')?.getAttribute('data-value')).toBe('4096')
    expect(markers(container)).toEqual({ mode: '1', fftSize: '2' })
    expect(screen.queryByTestId('fir-silent-hint')).toBeNull()
  })

  it('profile ticks the checkbox and shows the stay-silent hint', () => {
    const { container } = ui(<ReaFirPanel phase="profile" callouts={[{ n: 1, target: 'buildProfile' }]} />)
    expect(container.querySelector('[data-target="buildProfile"] [data-checked]')?.getAttribute('data-checked')).toBe('true')
    expect(screen.getByText('Automatically build noise profile (enable during silence)')).toBeTruthy()
    expect(screen.getByTestId('fir-silent-hint').textContent).toBe('Stay silent ~3 s')
    expect(markers(container)).toEqual({ buildProfile: '1' })
  })

  it('reduce draws the profile and the lowered curve', () => {
    ui(<ReaFirPanel phase="reduce" callouts={[{ n: 1, target: 'curve' }]} />)
    expect(screen.getByTestId('fir-profile')).toBeTruthy()
    expect(screen.getByTestId('fir-lowered')).toBeTruthy()
  })
})

describe('WaveLinkEffects', () => {
  it('lists the chain in order (on), the effects to switch off, and the highlighted row', () => {
    const { container } = ui(
      <WaveLinkEffects chain={['ReaFIR', 'ReaEQ', 'ReaComp']} off={['Noise Removal']} highlight="ReaEQ" callouts={[{ n: 1, target: 'addEffect' }, { n: 2, target: 'toggle-Noise Removal' }]} />,
    )
    const rows = screen.getAllByTestId('wl-row')
    expect(rows.map((r) => r.getAttribute('data-effect'))).toEqual(['ReaFIR', 'ReaEQ', 'ReaComp', 'Noise Removal'])
    expect(rows.map((r) => r.getAttribute('data-on'))).toEqual(['true', 'true', 'true', 'false'])
    expect(rows.map((r) => r.getAttribute('data-highlight'))).toEqual(['false', 'true', 'false', 'false'])
    expect(rows[2].textContent).toContain('3')
    expect(screen.getByText('Add effect')).toBeTruthy()
    expect(markers(container)).toEqual({ addEffect: '1', 'toggle-Noise Removal': '2' })
    expect(screen.getByText('Switch off: Noise Removal')).toBeTruthy()
  })
})
