// Language choice from the top bar: switches i18n and keeps a `?lang=` in the address bar in step,
// so a reload keeps the choice (detectLocale reads ?lang= first).
import { setLocale } from '../../i18n'
import type { Locale } from '../../i18n'

export function chooseLocale(l: Locale): void {
  setLocale(l)
  try {
    const url = new URL(location.href)
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', l)
      history.replaceState(history.state, '', url)
    }
  } catch {
    // no location/history (tests)
  }
}
