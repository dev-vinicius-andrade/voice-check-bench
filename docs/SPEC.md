# Voice Check Bench — Spec

## Goal
A local web app that records a voice in the browser, measures what makes it unclear (level, noise, hum, tone balance per octave, sibilance, consistency), guides the user through a fixed test session, and suggests ReaPlugs settings (ReaGate, ReaEQ, ReaComp) for Elgato Wave Link. A Python tool writes those settings straight into Wave Link's `Settings.json`.

The behaviour reference is the working single-file prototype: `docs/prototype/voice-check.html`. Port it; do not redesign the analysis. Where this spec and the prototype disagree, this spec wins.

## Non-goals
- No backend, accounts or cloud storage. Everything stays in the browser (IndexedDB + localStorage).
- No server rendering. Plain Vite SPA served on localhost.
- No chart library: the band chart is a hand-written SVG component.
- No MP3/WAV export of takes (may come later).

## Stack
- Vite 8, React 19, TypeScript 6 (strict), MUI 9 (`@mui/material`, `@mui/icons-material`, Emotion), Tailwind CSS 4 (`@tailwindcss/vite`), zustand 5, Vitest for unit tests, ESLint 10 flat config.
- MUI + Tailwind coexist through CSS layers: `@layer theme, base, mui, components, utilities;` declared first, `StyledEngineProvider enableCssLayer`. Tailwind is used for layout/spacing utilities; MUI for components and the theme. Do not restyle MUI internals with Tailwind.
- Theme (visual language of andradev.io, see `src/theme.ts`): MUI `createTheme` with `cssVariables` and `colorSchemes` light + dark, default follows the system. JetBrains Mono for everything. Accent olive `#b4b96b` (primary). Light: white background, text `#222`. Dark: background `#121212`, surfaces `#222`, text `#f5f5f5`. Status: success/warning/error from the theme; take B = info. Flat: no shadows, 1px dividers, pill buttons and chips, inputs radius 15. Headlines: uppercase, weight 800, two lines where the second line is in the accent color (`<TwoToneHeading first second />` in components/common).

## Architecture (src/)
| Module | Responsibility |
|---|---|
| `audio/dsp.ts` | FFT (radix-2), Hann window cache, power spectrum, `db`/`adb`, percentile/median. Pure. |
| `audio/reference.ts` | `BANDS` (9 octave bands 40 Hz–16 kHz with label, name, ref dB) and `deviations(rel)`. Pure. |
| `audio/analyze.ts` | `analyze(samples: Float32Array, sampleRate): Analysis \| AnalysisError`. Same algorithm and constants as the prototype (`QUIET_SEC=3`, `MAX_SEC=30`, 50 ms frames, robust noise estimate, speech mask, per-second spread, 8192-pt long-term spectra, hum peaks, 2048-pt sibilance). Pure. |
| `audio/diagnose.ts` | `diagnose(a): Check[]` with `{id, status: 'good'\|'warn'\|'bad', title, value, detail, fix}`. Same thresholds and texts as the prototype; add a stable `id` per check (level, peaks, noise, silence, hum, rumble, boom, warmth, mud, body, definition, presence, sibilance, air, harsh, consistency). Pure. |
| `audio/AudioEngine.ts` | One `AudioContext` (48 kHz). Opens an input with `getUserMedia` (echoCancellation, noiseSuppression, autoGainControl all false, deviceId exact), lists inputs (skip `default`/`communications`), exposes current RMS level, records mono PCM via an AudioWorklet (`public/worklets/recorder-worklet.js`, averages channels), plays a take back. No React. |
| `session/steps.ts` | The 4 guided steps (2 cm, 8 cm, 15 cm raw controls, processed take) with titles/leads/hints, device kinds `raw`/`fx` and name matchers. |
| `session/bestControl.ts` | Picks the best control take (lowest \|boom\|+\|warmth\|+\|mud\|+\|body\| deviation + SNR penalty). |
| `settings/suggest.ts` | `suggest(base)` → ReaGate/ReaEQ/ReaComp/De-Esser/Lowcut values (70 % correction, clamps, gain hint) ; `toText`, `toJson`. Same math as prototype. |
| `storage/takesDb.ts` | IndexedDB `voice-check-bench` v1, store `takes` keyPath `id`. Stores take without the analysis; analysis is recomputed on load. Fails soft (memory only) if IndexedDB is unavailable. |
| `storage/prefs.ts` | localStorage JSON helpers; keys `vcb-ui` (screen, step, session, A, B, view, fxDist) and `vcb-devs` (`{raw, fx}` device ids). try/catch everywhere. |
| `store/benchStore.ts` | zustand store: takes, A/B selection, chart view, screen, step, session id, fxDist, device choices, mic state, recording phase; actions. Persists UI prefs. |
| `hooks/` | `useAudioEngine`, `useLevel` (rAF level), `useRecorder` (phases idle → silence countdown → reading → analyzing; Space toggles, 30 s auto-stop), `useBootstrap` (load takes, restore prefs, auto-enable mic if permission granted). |
| `components/` | Screens and widgets (below). Each under ~150 lines. |
| `tools/apply-reaplugs.py` | Stdlib Python. Reads the exported JSON and writes ReaGate/ReaEQ/ReaComp `ParameterState` (+ De-Esser bypass) into Wave Link `Settings.json`. `--show`, preview by default, `--write` with backup; refuses `--write` on the real file while `Elgato.WaveLink.exe` runs. |

### Data model
`Take = { id: number (Date.now), name, session: string ('s<ts>' or 'free'), step: 'c2'|'c8'|'c15'|'fx'|null, device: string, sampleRate, samples: Float32Array, created: ISO }`; in memory also `analysis`.
Exported settings JSON (consumed by the Python tool): `{ basedOn, speechDbfs, noiseDbfs, gainHint, dist, lowcut, gate:{threshold,attack,hold,release,hysteresis,wet,dry}, eq:[{type:'Low Shelf'|'Band'|'High Shelf',freq,gain,bw,why}], comp:{threshold,ratio,attack,release,knee,wet,limit}, deess }`.

### Wave Link storage format (for tools/)
`%LOCALAPPDATA%\Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json` → `MixerConfiguration.InputSettings[<input with PCM_IN>].AudioPluginConfigurations[]`. `ParameterState` = base64 FXP (`CcnK`).
- ReaGate/ReaComp: `FxBk` bank, 156-byte header, then inner `FxCk` program: 56-byte header then 19 big-endian floats. ReaGate: 0 threshold (linear amp), 1 attack ms/500, 2 release ms/5000, 4 hold ms/1000, 9 dry amp, 10 wet amp, 12 hysteresis amp. ReaComp: 0 threshold amp, 1 ratio (r-1)/99, 2 attack ms/500, 3 release ms/5000, 11 wet amp, 17 limit output 0/1.
- ReaEQ: `FBCh`, 156-byte header, big-endian int32 chunk size, chunk little-endian: int32 version (33), int32 band count, per band `int32 type (0 low shelf, 1 high shelf, 8 band), int32 enabled, f64 freq Hz, f64 gain linear, f64 bandwidth oct, u8 flag`, then a 20-byte tail kept as is.
- Verified by decoding values set in the UI. Round-trip (decode → encode unchanged) must be byte-identical.

## UI (decided; follow the prototype)
A wizard in the andradev.io look (see Theme). Top bar: product name + progress stepper `Setup · 2 cm · 8 cm · 15 cm · Processed · Results` (MUI Stepper with clickable StepButtons; completed steps show a check).
1. **Setup** (centered column, max ~760 px): eyebrow, title "Find out what's making your voice unclear", lead; list of the 4 takes with the input each uses; mic card: "Enable microphone" → then two selects "Raw mic, no effects · steps 1–3" and "With your effects · step 4" (auto-picked by name, saved), each with a Test button, plus "Listening: <device>" and a level meter; "Start step 1 →". "See previous results" if analyzed takes exist.
2. **Step** (centered): eyebrow `Step n of 4 · Control test`, big title ("Record at 8 cm, raw mic"), lead; distance ruler SVG (mouth → mic, 0–16 cm, accent bar to the distance); input bar (device name, small meter, Change → reveals select; changing it updates the choice for that device kind); card with recording cue (idle hint / amber "3-2-1 Stay silent, measuring the room" / green "Read the text now" + elapsed, progress bar), the reading text large (24 px, dimmed until reading), a big round record button (red dot → square while recording), "Space to start and stop". After a take: summary card (verdict line, speech/noise/SNR/boom/body, Play, "press record again to replace"). Nav: ← Back · Skip · Next → (Next enabled only with a valid take; Enter = Next). Free-take variant: name field, input select shown, Next → results.
3. **Results** (two columns ≥ 980 px, stacked below): main panel = A/B header with chips, view toggle A | A + B | A − B, verdict alert ("Fix first: …" + first fix), 4 stat tiles (B value under each), band chart (deviation vs reference with ±3/±6 zones; diff mode without zones), compare table (session takes or A/B; status-coloured cells; "best" badge), checks (problems listed, passing in a collapsible "N checks passing"), suggested ReaPlugs settings panel (per-plugin cards, gain hint warning, buttons Copy as text / Download .txt / Download .json, note about `tools/apply-reaplugs.py`). Side panel = takes grouped by session (A/B toggles, play, delete; Delete all with second-click confirm), New session, Record a free take.
After the processed step the results open with A = processed, B = best control, view = A − B.

## Definition of done (MVP)
- `npm run dev` serves the app; `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.
- Analysis numbers match the prototype for the same samples (unit test with a synthetic signal; spot-check against a real WAV when available).
- Full guided flow works in Chrome with a real mic; takes and UI state survive a reload.
- Settings export matches the prototype; `tools/apply-reaplugs.py --show` decodes, round-trip test passes.
- Works in light and dark, and at 400 px wide without horizontal scroll.
