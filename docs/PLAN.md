# Plan

Status: `[ ]` todo · `[~]` in progress · `[x]` accepted. Spec: `docs/SPEC.md`. Behaviour reference: `docs/prototype/voice-check.html`.

1. `[x]` **Scaffold** — Light. Deps are already installed (see package.json); add `vitest` + `jsdom` dev deps. Create `index.html`, `vite.config.ts` (react + tailwind plugins, vitest config), `tsconfig*.json` (strict, bundler resolution), `eslint.config.js` (flat, ts + react-hooks + react-refresh), `src/main.tsx`, `src/App.tsx` (placeholder that renders the three screen names), `src/index.css` (layer order + `@import "tailwindcss"`), `src/theme.ts` (light/dark palette and fonts from SPEC), `public/worklets/` empty dir with `.gitkeep`, package scripts `test`. Verify: dev server starts, `npm run build`, `typecheck`, `lint`, `test` (with one trivial test) pass. Depends: none.
2. `[x]` **Analysis engine** — Careful. Port `audio/dsp.ts`, `audio/reference.ts`, `audio/analyze.ts`, `audio/diagnose.ts`, `session/steps.ts`, `session/bestControl.ts`, `settings/suggest.ts` from the prototype `<script>` into strict TS, pure functions, exported types. Add stable check ids. Vitest: FFT of a sine, analyze() on a synthetic take (3 s low noise + 10 s band-limited noise "speech") gives sane values and no error, diagnose ids are unique, suggest() clamps and text/json shapes. Depends: 1.
3. `[x]` **Platform layer** — Medium. `audio/AudioEngine.ts` (+ `public/worklets/recorder-worklet.js`), `storage/takesDb.ts`, `storage/prefs.ts`, `audio/playback` inside the engine. Behaviour per SPEC. No React. Verify: typecheck + lint; a unit test for prefs (jsdom localStorage) and for takesDb fail-soft path. Depends: 1.
4. `[x]` **Store and hooks** — Careful. `store/benchStore.ts` + `hooks/useAudioEngine`, `useLevel`, `useRecorder`, `useBootstrap`. All navigation rules from SPEC UI section (next/back/skip, auto A/B on results, best control, fxDist, re-record replaces latest for that step in the session, delete/delete all, new session, free take). Verify: typecheck, lint, store unit tests for navigation and A/B logic. Depends: 2, 3.
5. `[x]` **Setup + Step screens** — Medium. `components/layout/TopBar`, `ProgressStepper`; `components/setup/*`; `components/step/*` (DistanceRuler, InputBar, RecordingCue, ReadingText, RecordButton, TakeSummary, StepNav); `components/common/LevelMeter`. Exact design in SPEC UI 1–2. Depends: 4.
6. `[x]` **Results screen** — Medium. `components/results/*` (ResultsHeader, VerdictAlert, StatTiles, BandChart, CompareTable, ChecksList, SuggestedSettings, TakesList). Exact design in SPEC UI 3. Depends: 4.
7. `[x]` **Wave Link tool + docs** — Medium. Harden `tools/apply-reaplugs.py` (running-check only for the real file; preserve CRLF + 2-space indent; `--show`; `--self-test` that round-trips the current file byte-identically); add `tools/README.md`; root `README.md` (what it is, run, workflow, tool usage). Depends: 1.
8. `[x]` **Integration check** — orchestrator. Full flow in the browser, light/dark, 400 px, reload persistence, build/lint/test.

## v0.2 — Noisy-room mode (SPEC "Noisy-room mode")
9. `[x]` **Noise diagnosis** — Careful. Also: make every diagnose text generic (no model names). analyze.ts (speechBands, noiseBands, bandSnr, tones, noiseKind), diagnose.ts (tones, bandsnr checks), bestControl weighting, testSignals fixture update, tests incl. `_test/control-2-cm-raw.wav` (server + ceiling fan: expect tones near 200, 770–790, 1560 Hz; noiseKind tonal; snr < 20). Depends: types.
10. `[x]` **Noisy-room suggestions** — Careful. suggest.ts per SPEC (chain, ReaFIR plan, notches, no boosts in noisy bands, compressor/expander), text/JSON, tests. Depends: types (uses Analysis fields; tests use fakeAnalysis with explicit values).
11. `[x]` **Room noise + mic profile UI** — Careful. src/mics/catalog.ts; store micProfile/setMicProfile + prefs 'vcb-mic' + take.mic; Setup 'Your microphone' card, room reading + placement tip; step tips from profile; generic step copy; results RoomNoisePanel + BeforeAfterCard + 'Copy anonymized summary'; SuggestedSettings chain + ReaFIR steps. Depends: types.
12. `[x]` **Integration** — orchestrator. Real WAV check, browser check, commit.

## v0.3 — Community results via GitHub issues (SPEC "Community results via GitHub issues")
13. `[x]` **Issue form, validation, aggregation, Action** — Careful. `.github/ISSUE_TEMPLATE/mic-result.yml`, `src/community/validate.ts`, `src/community/aggregate.ts`, `tools/community/aggregate.ts`, `.github/workflows/community.yml`.
14. `[x]` **Share + community display UI** — Medium. `src/community/summary.ts`, `shareUrl.ts`, `useCommunity.ts`, ShareCommunityButton, CommunityMicCard, setup CommunityMicLine.
15. `[x]` **Integration** — orchestrator. Real WAV → summary → share URL (5.2 kB, no device names) → issue body → validate → aggregate.

## v0.4 — Site pages (SPEC "Site pages")
16. `[x]` **Routing, nav, footer, demo** — Careful. Hash routing in the store, TopBar nav, Footer, demo session loader + banner.
17. `[x]` **Content pages** — Medium. Home, How it works, Community, Privacy.

## v0.5 — Plain language / v0.6 — Localization (SPEC "Plain language", "Languages and localization")
18. `[x]` **Plain engine** — Careful. src/plain/{types,score,ratings,actions,glossary}.ts + tests; returns message keys; English strings in src/i18n/locales/en.json (plain namespace).
19. `[x]` **i18n infrastructure** — Medium. i18next setup, detection, switcher, Intl helpers, region/mains setting. After task 16.
20. `[x]` **Plain results UI** — Medium. After 18, 19.
21. `[x]` **Plain wizard, setup, pages + string extraction** — Medium. After 19.
22. `[x]` **pt-BR translation, reading passages, engine text keys (diagnose/suggest)** — Careful. After 20, 21.

## v0.7 — Guided setup with interactive replicas (SPEC "Guided setup …")
23. `[x]` **Host picker + guide shell** (checklist, steps, "Show me how" entry points) — Medium. After 20–22.
24. `[x]` **ReaPlugs replicas** (ReaFIR, ReaEQ with computed curve, ReaComp, ReaGate) + Wave Link effects list replica — Careful.
25. `[x]` **OBS and app-only paths** — Medium.

## v0.8 — Over-processing safety (SPEC "Over-processing safety")
26. `[x]` **Detect over-processing** — Careful. analyze clamps + zeroRatio/gateSwitches, overprocessed check, processed-vs-raw comparison, score/actions/headline, en+pt-BR keys. Test with the real processed WAV.
27. `[x]` **Safer suggestions and guide** — Medium. ReaFIR 6 dB start, preferAi ordering, makeup note, processed step at best distance, guide copy en+pt-BR.

## v0.9 — Voice goals (SPEC "Voice goals") / v1.0 — Profiles (SPEC "Profiles")
28. `[x]` **Goal engine** — Careful. VoiceGoal types, targetDeviations, goal threaded through diagnose/plain/suggest/bestControl, perceived-issue fusion, nasal EQ band, tests.
29. `[x]` **Goal UI** — Medium. Setup goal card, results "Change goal", charts "your target", en+pt-BR.
30. `[x]` **Wave Link file round trip + profiles logic** — Careful. TS port of the Settings.json codec (byte-identical round trip on the real file), diff, apply, backup naming; profiles IndexedDB store + migration, validation rule, import/export schema.
31. `[x]` **Wave Link + profiles UI** — Medium. Upload/preview/download flow (+ Chrome/Edge direct save), #/profiles page, Save as profile, Apply/Re-test/Export/Import/Duplicate/Rename/Delete, en+pt-BR.

## v1.1 — Refinement loop (SPEC "Refinement loop")
32. `[x]` **Engine fixes + refine()** — Careful.
33. `[x]` **Loop UI + applied tracking** — Medium.

## v1.2 — Community checks and votes (SPEC "Community results via GitHub issues": Automatic checks, Votes)
34. `[x]` **Issue checker, mic matching, votes** — Careful. `src/community/micMatch.ts`, `src/community/review.ts`, `parseSummaryDetailed` in `validate.ts`, `aggregate()` over reviewed reports + `solutions`, `tools/community/review.ts` (`npm run community:review`), `tools/community/github.ts`, `tools/community/aliases.json`, workflow jobs `review` → `aggregate`, cron every 6 hours.

## v1.3 — Refinement fixes (SPEC "Refinement loop (v1.1)": too loud, chopped advice, real processed distance)
35. `[x]` **Too loud, chopped advice, processed-take distance** — Careful. `tooLoud` regression (peak ≥ −1 dBFS or speech above the good level range) → Wet down to −21 dBFS and "harsh from clipping" instead of EQ cuts; quieter capped at −21 dBFS; chopped with the gate already off → AI remover lower / another effect; "Where are you recording?" picker on the processed step; distance mismatch vs `applied.dist`; "Make settings for {{actual}}"; tests, en+pt-BR.

## v1.3 — Live tuning (SPEC "Live tuning (v1.3)")
36. `[x]` **Live tuning screen** — Medium. Route `#/live` (Screen 'live', nav "Tune live", entries in the guide and the refine / change-approach cards), `src/components/live/*` (pickers, Start/Stop, status chip, LiveError alerts, Loudness / Pauses / Tone / Try now panels, reading text), `useLiveSession` over `createLiveSession`, localStorage `vcb-live-devices`, `live.json` en + pt-BR, tests with a fake session.

## v2.0 — Desktop app (SPEC "Desktop app (v2.0)"; spikes in `spike/`)
37. `[ ]` **Desktop scaffold** — Medium.
    - Tauri v2 in `desktop/`, frontend = this Vite app, `isDesktop()` bridge in `src/desktop/bridge.ts`.
    - Scripts `desktop:dev` and `desktop:build`, CLAUDE.md commands, CI build check.
    - Verify: `npm run desktop:build` produces an installer, and the web build is unchanged.
38. `[ ]` **Plugin host engine** — Careful. After 37.
    - `host/vst2`, `host/vst3` and `chain` from the spike code: message-loop thread, latency compensation, bypass handling, state import/export.
    - Verify: Rust tests on a Settings copy. ReaGate, ReaComp, ReaEQ and the three Elgato states round-trip byte-identical; ReaFIR is equal by parameters. Offline chain on a `_test` take matches the spike numbers.
39. `[ ]` **Audio engine + stream** — Careful. After 38.
    - cpal I/O, parameter queue, monitor modes, aligned raw/processed channel, counters.
    - Verify: a 10 min run with 0 underruns, processing p99 < 20 % of a block, measured alignment 0 samples.
40. `[ ]` **Wave Link read + export** — Careful. After 37; can run in parallel with 38.
    - Read the chain, diff, backup, close/write/restart, verify, restore.
    - Verify: tests on copies only, then a manual run by the user.
41. `[ ]` **Hold + history + segments** — Careful. After 37; can run in parallel.
    - Framework-free TS in `src/desktop/` and in the web `src/live/`: hold, 60 s history, segments, summaries.
    - Verify: tests.
42. `[ ]` **Live advice → parameter changes** — Careful. After 41.
    - A pure module mapping metrics + chain values to changes, using the refine rules and constants, with Undo.
    - Verify: a test for each rule.
43. `[ ]` **Desktop UI** — Medium. After 39–42, and after the user approves a mockup.
    - Device pickers, plugin cards with sliders, monitor A/B, history chart, segment table, advice list, export dialog with diff.
    - en + pt-BR.
44. `[ ]` **Release + download page** — Medium. After 43.
    - Tag workflow → GitHub Release, the site's "Desktop app" page, README.
