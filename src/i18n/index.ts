// i18n setup (SPEC "Languages and localization"). One JSON bundle per locale; keys are full dotted paths
// (e.g. "plain.score.clear"), so framework-free modules can return { key, params } and the UI renders t(key, params).
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { BUNDLES } from './bundles'

export const LOCALES = ['en', 'pt-BR'] as const
export type Locale = (typeof LOCALES)[number]
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', 'pt-BR': 'Português (Brasil)' }
const STORAGE_KEY = 'vcb-lang'

const asLocale = (v: string | null | undefined): Locale | null => {
  if (!v) return null
  const exact = LOCALES.find((l) => l.toLowerCase() === v.toLowerCase())
  if (exact) return exact
  if (v.toLowerCase().startsWith('pt')) return 'pt-BR'
  if (v.toLowerCase().startsWith('en')) return 'en'
  return null
}

/** ?lang= → saved choice → browser languages → en. */
export function detectLocale(): Locale {
  try {
    const fromUrl = asLocale(new URLSearchParams(location.search).get('lang'))
    if (fromUrl) return fromUrl
  } catch {
    // no location (tests)
  }
  try {
    const saved = asLocale(localStorage.getItem(STORAGE_KEY))
    if (saved) return saved
  } catch {
    // storage blocked
  }
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
  for (const l of langs) {
    const m = asLocale(l)
    if (m) return m
  }
  return 'en'
}

export function setLocale(l: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    // storage blocked
  }
  void i18n.changeLanguage(l)
  if (typeof document !== 'undefined') document.documentElement.lang = l
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: BUNDLES.en }, 'pt-BR': { translation: BUNDLES['pt-BR'] } },
  lng: detectLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
})
if (typeof document !== 'undefined') document.documentElement.lang = i18n.language

export const currentLocale = (): Locale => asLocale(i18n.language) ?? 'en'

export default i18n
