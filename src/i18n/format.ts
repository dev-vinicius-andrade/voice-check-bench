// Locale-aware formatting for anything shown on screen. Exported files (JSON, the Python tool) never use these.
import { currentLocale } from './index'

const cache = new Map<string, Intl.NumberFormat>()
const nf = (digits: number, signed: boolean): Intl.NumberFormat => {
  const key = `${currentLocale()}|${digits}|${signed}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(currentLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: signed ? 'exceptZero' : 'auto',
    })
    cache.set(key, f)
  }
  return f
}

/** 1234.5 → "1,234.5" (en) / "1.234,5" (pt-BR). NaN/±Infinity → "—". */
export const fmtNum = (v: number, digits = 1): string => (Number.isFinite(v) ? nf(digits, false).format(v) : '—')
/** Signed: +3.0 / −4.5 (no sign for zero). */
export const fmtSigned = (v: number, digits = 1): string => (Number.isFinite(v) ? nf(digits, true).format(v) : '—')
/** "-27.4 dBFS" / "-27,4 dBFS". */
export const fmtDbfs = (v: number, digits = 1): string => `${fmtNum(v, digits)} dBFS`
/** "+3.0 dB". */
export const fmtDb = (v: number, digits = 1, signed = true): string => `${signed ? fmtSigned(v, digits) : fmtNum(v, digits)} dB`
/** Whole hertz below 10 kHz (tells close tones apart), kHz above. No thousands separator: people type these values into plugins. */
export const fmtHz = (hz: number): string =>
  hz >= 10000 ? `${fmtNum(hz / 1000, 1)} kHz` : `${Math.round(hz)} Hz`
/** "8 cm" plus inches for en-US: "8 cm (3 in)". */
export const fmtCm = (cm: number): string => {
  const base = `${fmtNum(cm, 0)} cm`
  const usesInches = typeof navigator !== 'undefined' && (navigator.language === 'en-US' || navigator.languages?.[0] === 'en-US')
  return currentLocale() === 'en' && usesInches ? `${base} (${fmtNum(Math.max(1, Math.round(cm / 2.54)), 0)} in)` : base
}
/** Date + time, short, in the active locale. */
export const fmtDateTime = (d: Date | string | number): string =>
  new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(d))
export const fmtDate = (d: Date | string | number): string =>
  new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium' }).format(new Date(d))
