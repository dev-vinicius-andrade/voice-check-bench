// Vitest setup: the whole suite runs many jsdom files at once, and a screen's first render can then take longer than
// Testing Library's default 1 s wait. Waits get 5 s (a passing test never uses it up).
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react')
  configure({ asyncUtilTimeout: 5000 })
}
