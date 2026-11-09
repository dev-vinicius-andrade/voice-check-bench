// Hash routing without a router library (SPEC "Site pages"): the URL hash and the store's screen follow each other.
// #/ home · #/how-it-works · #/community · #/privacy · #/check (setup or step) · #/results · #/guide.
import { useEffect } from 'react'
import type { BenchState } from '../store/api'
import { useBench } from '../store/benchStore'
import type { Screen, StepRef } from '../types'

export type Route = 'home' | 'how' | 'community' | 'privacy' | 'check' | 'results' | 'guide'

const ROUTE_HASH: Record<Route, string> = {
  home: '#/',
  how: '#/how-it-works',
  community: '#/community',
  privacy: '#/privacy',
  check: '#/check',
  results: '#/results',
  guide: '#/guide',
}

export interface RouteContext {
  screen: Screen
  step: StepRef
  /** The current session has at least one take. */
  hasSessionTakes: boolean
}

export interface RouteTarget {
  screen: Screen
  step?: StepRef
}

/** null when there is no route in the hash ('' or '#'); unknown hashes are home. */
export function hashToRoute(hash: string): Route | null {
  const path = hash.replace(/^#/, '')
  if (path === '') return null
  const clean = '#/' + path.replace(/^\/+/, '').replace(/\/+$/, '')
  return (Object.keys(ROUTE_HASH) as Route[]).find((r) => ROUTE_HASH[r] === clean) ?? 'home'
}

export function screenToHash(screen: Screen): string {
  return ROUTE_HASH[screen === 'setup' || screen === 'step' ? 'check' : screen]
}

/** Where a route goes from the current state; null = already there. #/check keeps the store's step once the session has takes. */
export function routeToScreen(route: Route, ctx: RouteContext): RouteTarget | null {
  if (route === 'check') {
    if (ctx.screen === 'setup' || ctx.screen === 'step') return null
    return ctx.hasSessionTakes ? { screen: 'step', step: ctx.step } : { screen: 'setup' }
  }
  return ctx.screen === route ? null : { screen: route }
}

/** The navigation a hash asks for; null when there is nothing to do (no hash, or already on that screen). */
export function hashToScreen(hash: string, ctx: RouteContext): RouteTarget | null {
  const route = hashToRoute(hash)
  return route ? routeToScreen(route, ctx) : null
}

export const routeContext = (s: Pick<BenchState, 'screen' | 'step' | 'takes' | 'session'>): RouteContext => ({
  screen: s.screen,
  step: s.step,
  hasSessionTakes: s.takes.some((t) => t.session === s.session),
})

const isContentRoute = (r: Route | null): boolean => r === 'home' || r === 'how' || r === 'community' || r === 'privacy'

/**
 * Mount once (App). Before the takes load only site-page hashes apply (they need no data); once the store is
 * ready the hash wins over the saved screen, and an empty hash keeps it. Afterwards hashchange/popstate → goTo,
 * and screen changes push one history entry per new hash.
 */
export function useHashRoute(): void {
  useEffect(() => {
    let synced = false
    let applying = false

    const go = (target: RouteTarget | null): void => {
      if (!target) return
      applying = true
      try {
        useBench.getState().goTo(target.screen, target.step)
      } finally {
        applying = false
      }
    }
    /** Show the canonical hash of the current screen without adding a history entry. */
    const canonicalize = (): void => {
      const want = screenToHash(useBench.getState().screen)
      if (location.hash !== want) history.replaceState(history.state, '', want)
    }
    const onHashChange = (): void => {
      if (!synced) return
      go(routeToScreen(hashToRoute(location.hash) ?? 'home', routeContext(useBench.getState())))
      canonicalize()
    }
    const sync = (): void => {
      synced = true
      go(hashToScreen(location.hash, routeContext(useBench.getState())))
      canonicalize()
    }

    if (!useBench.getState().ready && isContentRoute(hashToRoute(location.hash)))
      go(hashToScreen(location.hash, routeContext(useBench.getState())))

    const unsubscribe = useBench.subscribe((s, prev) => {
      if (!synced) {
        if (s.ready) sync()
        return
      }
      if (s.screen !== prev.screen) window.scrollTo({ top: 0 })
      if (applying || s.screen === prev.screen) return
      const want = screenToHash(s.screen)
      if (location.hash !== want) history.pushState(history.state, '', want)
    })
    if (useBench.getState().ready) sync()

    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('popstate', onHashChange)
    return () => {
      unsubscribe()
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('popstate', onHashChange)
    }
  }, [])
}
