// Merges the per-area locale files into one bundle per locale. Each area file has its own top-level key
// (plain, engine, common, results, wizard, pages, guide, replicas, suggestx, profiles, live, desktop) so tasks can edit different files without conflicts.
import enCommon from './locales/en/common.json'
import enDesktop from './locales/en/desktop.json'
import enEngine from './locales/en/engine.json'
import enGuide from './locales/en/guide.json'
import enLive from './locales/en/live.json'
import enPages from './locales/en/pages.json'
import enPlain from './locales/en/plain.json'
import enProfiles from './locales/en/profiles.json'
import enReplicas from './locales/en/replicas.json'
import enResults from './locales/en/results.json'
import enSuggest from './locales/en/suggest.json'
import enWizard from './locales/en/wizard.json'
import ptCommon from './locales/pt-BR/common.json'
import ptDesktop from './locales/pt-BR/desktop.json'
import ptEngine from './locales/pt-BR/engine.json'
import ptGuide from './locales/pt-BR/guide.json'
import ptLive from './locales/pt-BR/live.json'
import ptPages from './locales/pt-BR/pages.json'
import ptPlain from './locales/pt-BR/plain.json'
import ptProfiles from './locales/pt-BR/profiles.json'
import ptReplicas from './locales/pt-BR/replicas.json'
import ptResults from './locales/pt-BR/results.json'
import ptSuggest from './locales/pt-BR/suggest.json'
import ptWizard from './locales/pt-BR/wizard.json'

export const BUNDLES = {
  en: { ...enPlain, ...enEngine, ...enCommon, ...enResults, ...enWizard, ...enPages, ...enGuide, ...enReplicas, ...enSuggest, ...enProfiles, ...enLive, ...enDesktop },
  'pt-BR': { ...ptPlain, ...ptEngine, ...ptCommon, ...ptResults, ...ptWizard, ...ptPages, ...ptGuide, ...ptReplicas, ...ptSuggest, ...ptProfiles, ...ptLive, ...ptDesktop },
} as const
