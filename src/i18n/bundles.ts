// Merges the per-area locale files into one bundle per locale. Each area file has its own top-level key
// (plain, common, results, wizard, pages) so tasks can edit different files without conflicts.
import enCommon from './locales/en/common.json'
import enPages from './locales/en/pages.json'
import enPlain from './locales/en/plain.json'
import enResults from './locales/en/results.json'
import enWizard from './locales/en/wizard.json'
import ptCommon from './locales/pt-BR/common.json'
import ptPages from './locales/pt-BR/pages.json'
import ptPlain from './locales/pt-BR/plain.json'
import ptResults from './locales/pt-BR/results.json'
import ptWizard from './locales/pt-BR/wizard.json'

export const BUNDLES = {
  en: { ...enPlain, ...enCommon, ...enResults, ...enWizard, ...enPages },
  'pt-BR': { ...ptPlain, ...ptCommon, ...ptResults, ...ptWizard, ...ptPages },
} as const
