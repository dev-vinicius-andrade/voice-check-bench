import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initialBenchState, useBench } from '../store/benchStore'
import type { Take } from '../types'
import { fakeAnalysis } from '../audio/testSignals'
import { hashToRoute, hashToScreen, routeToScreen, screenToHash, useHashRoute, type RouteContext } from './useHashRoute'

const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({ screen: 'home', step: 0, hasSessionTakes: false, ...over })

describe('hash ↔ screen mapping', () => {
  it('maps hashes to routes', () => {
    expect(hashToRoute('')).toBeNull()
    expect(hashToRoute('#')).toBeNull()
    expect(hashToRoute('#/')).toBe('home')
    expect(hashToRoute('#/how-it-works')).toBe('how')
    expect(hashToRoute('#/community/')).toBe('community')
    expect(hashToRoute('#privacy')).toBe('privacy')
    expect(hashToRoute('#/check')).toBe('check')
    expect(hashToRoute('#/results')).toBe('results')
    expect(hashToRoute('#/guide')).toBe('guide')
    expect(hashToRoute('#/nope')).toBe('home')
  })

  it('maps screens to hashes (setup and step share #/check)', () => {
    expect(screenToHash('home')).toBe('#/')
    expect(screenToHash('how')).toBe('#/how-it-works')
    expect(screenToHash('community')).toBe('#/community')
    expect(screenToHash('privacy')).toBe('#/privacy')
    expect(screenToHash('setup')).toBe('#/check')
    expect(screenToHash('step')).toBe('#/check')
    expect(screenToHash('results')).toBe('#/results')
    expect(screenToHash('guide')).toBe('#/guide')
    for (const s of ['home', 'how', 'community', 'privacy', 'results', 'guide'] as const) expect(hashToRoute(screenToHash(s))).toBe(s)
  })

  it('resolves #/check to setup, or to the store step once the session has takes', () => {
    expect(routeToScreen('check', ctx())).toEqual({ screen: 'setup' })
    expect(routeToScreen('check', ctx({ screen: 'results', step: 2, hasSessionTakes: true }))).toEqual({ screen: 'step', step: 2 })
    expect(routeToScreen('check', ctx({ screen: 'step', step: 1 }))).toBeNull()
    expect(routeToScreen('check', ctx({ screen: 'setup', hasSessionTakes: true }))).toBeNull()
  })

  it('returns null when there is no hash or the screen is already shown', () => {
    expect(hashToScreen('', ctx({ screen: 'results' }))).toBeNull()
    expect(hashToScreen('#/results', ctx({ screen: 'results' }))).toBeNull()
    expect(hashToScreen('#/privacy', ctx({ screen: 'results' }))).toEqual({ screen: 'privacy' })
    expect(hashToScreen('#/bogus', ctx({ screen: 'setup' }))).toEqual({ screen: 'home' })
  })
})

describe('useHashRoute', () => {
  let root: Root
  let host: HTMLElement
  const st = () => useBench.getState()
  const take = (id: number, session: string): Take => ({
    id, name: 't', session, step: 'c2', device: '', sampleRate: 48000, samples: new Float32Array(4), created: '', analysis: fakeAnalysis(),
  })
  const mount = (): void => {
    host = document.createElement('div')
    root = createRoot(host)
    act(() => root.render(createElement(() => (useHashRoute(), null))))
  }
  const setHash = (hash: string): void => {
    history.pushState(null, '', hash)
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    history.replaceState(null, '', '/')
    useBench.setState({ ...initialBenchState(), session: 's1', ready: true })
  })
  afterEach(() => act(() => root.unmount()))

  it('keeps the saved screen when there is no hash and writes its hash', () => {
    useBench.setState({ screen: 'results' })
    mount()
    expect(st().screen).toBe('results')
    expect(location.hash).toBe('#/results')
  })

  it('lets the hash win on load, then follows hashchange and pushes one entry per new hash', () => {
    history.replaceState(null, '', '#/privacy')
    mount()
    expect(st().screen).toBe('privacy')
    const len = history.length
    act(() => st().goTo('setup'))
    expect(location.hash).toBe('#/check')
    expect(history.length).toBe(len + 1)
    act(() => st().goTo('step', 1))
    expect(history.length).toBe(len + 1)
    setHash('#/how-it-works')
    expect(st().screen).toBe('how')
    useBench.setState({ takes: [take(1, 's1')] })
    setHash('#/check')
    expect([st().screen, st().step]).toEqual(['step', 1])
    setHash('#/whatever')
    expect(st().screen).toBe('home')
    expect(location.hash).toBe('#/')
  })

  it('waits for the store to be ready before applying a wizard hash', () => {
    useBench.setState({ ready: false, screen: 'home' })
    history.replaceState(null, '', '#/results')
    mount()
    expect(st().screen).toBe('home')
    act(() => {
      st().goTo('setup')
      useBench.setState({ ready: true })
    })
    expect(st().screen).toBe('results')
    expect(location.hash).toBe('#/results')
  })

  it('applies a page hash before the store is ready', () => {
    useBench.setState({ ready: false, screen: 'home' })
    history.replaceState(null, '', '#/community')
    mount()
    expect(st().screen).toBe('community')
  })

  it('opens the guide from #/guide once the store is ready', () => {
    history.replaceState(null, '', '#/guide')
    mount()
    expect(st().screen).toBe('guide')
    act(() => st().goTo('results'))
    expect(location.hash).toBe('#/results')
    setHash('#/guide')
    expect(st().screen).toBe('guide')
    expect(location.hash).toBe('#/guide')
  })
})
