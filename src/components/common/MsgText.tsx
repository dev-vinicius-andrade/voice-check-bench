// Renders plain-language message keys (Msg from src/plain/types.ts) through i18n.
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Msg } from '../../plain/types'

/** Translator for Msg values: (m) => t(m.key, m.params). */
// eslint-disable-next-line react-refresh/only-export-components
export function useMsg(): (m: Msg) => string {
  const { t } = useTranslation()
  return useCallback((m: Msg) => t(m.key, m.params ?? {}), [t])
}

/** `<MsgText msg={…} />` → the translated text of a Msg. */
export function MsgText({ msg }: { msg: Msg }) {
  const tm = useMsg()
  return <>{tm(msg)}</>
}
