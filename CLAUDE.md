# voice-check-bench

Stack: Vite 8 · React 19 · TypeScript 6 strict · MUI 9 + Emotion · Tailwind 4 · zustand 5 · Vitest. Python 3 stdlib for `tools/`.

## Commands
- `npm run dev` — dev server (http://localhost:5173)
- `npm run build` — typecheck + production build
- `npm run typecheck` · `npm run lint` · `npm test`
- `npm run desktop:dev` — desktop app (Tauri) with Vite on port 1420
- `npm run desktop:build` — desktop NSIS installer (`desktop/src-tauri/target/release/bundle/nsis/`)
- `python tools/apply-reaplugs.py --show` — print current Wave Link ReaPlugs values

## Conventions
- Behaviour reference is `docs/prototype/voice-check.html`. Port its logic and constants; do not invent new analysis math or UI flows. Spec: `docs/SPEC.md`. Tasks: `docs/PLAN.md`.
- `src/audio`, `src/session`, `src/settings`, `src/storage` are framework-free TypeScript. No React imports there.
- MUI for components and theme; Tailwind only for layout/spacing utilities. CSS layer order `theme, base, mui, components, utilities` must stay first in `src/index.css`.
- Colors come from the MUI theme (`theme.palette.*` / CSS vars). No hard-coded hex in components; good/warn/bad map to `success`/`warning`/`error`, take B to `info`.
- Components stay under ~150 lines; extract hooks for stateful logic. No `any`.
- Browser storage access always in try/catch; the app must work when IndexedDB or localStorage is blocked.
- Update `filemap.md` when adding or moving files.
- UI text goes through i18n (`useTranslation()` → `t('area.key', params)`); English source strings in `src/i18n/locales/en/<area>.json`, Portuguese in `pt-BR/<area>.json`. Numbers/dates on screen via `src/i18n/format.ts`, never `toFixed` in components. Framework-free modules return `Msg` keys (src/plain/types.ts). Plugin and product names are never translated.
