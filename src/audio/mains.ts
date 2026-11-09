// Mains (power grid) frequency: 50 or 60 Hz by country (SPEC "Languages and localization", region setting). Pure.

export type Mains = 50 | 60
/** What the person picked on the setup screen; 'auto' follows the browser's locale region. */
export type MainsSetting = Mains | 'auto'
export const MAINS_SETTINGS: readonly MainsSetting[] = ['auto', 50, 60]

/** Regions on a 60 Hz grid (Japan is split: the west runs at 60 Hz, the east at 50 Hz). Everything else: 50 Hz. */
export const MAINS_60_REGIONS: ReadonlySet<string> = new Set(['US', 'CA', 'MX', 'BR', 'CO', 'VE', 'PH', 'TW', 'KR', 'SA', 'JP'])

/** Region subtag of a BCP 47 tag ("pt-BR" → "BR", "zh-Hant-TW" → "TW", "es-419" → "419"), or null. */
export function regionOf(tag: string): string | null {
  for (const part of tag.split(/[-_]/).slice(1)) {
    if (/^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)) return part.toUpperCase()
  }
  return null
}

/** 60 for a 60 Hz region, 50 otherwise. Uses the first language tag that names a region; 50 when none does. */
export function mainsForLocale(tags: readonly string[]): Mains {
  for (const tag of tags) {
    const region = regionOf(tag)
    if (region) return MAINS_60_REGIONS.has(region) ? 60 : 50
  }
  return 50
}

/** Browser language tags (navigator.languages, else navigator.language); empty outside a browser. */
function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  const list = navigator.languages?.length ? [...navigator.languages] : []
  return list.length ? list : navigator.language ? [navigator.language] : []
}

/** The frequency to use for an analysis: the setting, or the locale region for 'auto'. */
export const resolveMains = (setting: MainsSetting, tags: readonly string[] = browserLanguages()): Mains =>
  setting === 'auto' ? mainsForLocale(tags) : setting

/** Hum frequencies to measure: the local family first (50/100/150 or 60/120/180), then the other; prototype order when unknown. */
export function humFrequencies(mains?: Mains): number[] {
  const fam = (f: Mains): number[] => [f, 2 * f, 3 * f]
  if (mains === 50) return [...fam(50), ...fam(60)]
  if (mains === 60) return [...fam(60), ...fam(50)]
  return [50, 60, 100, 120, 150, 180]
}

export const isMainsSetting = (v: unknown): v is MainsSetting => v === 'auto' || v === 50 || v === 60
