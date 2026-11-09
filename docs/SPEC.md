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
- Theme (visual language of andradev.io, see `src/theme.ts`): MUI `createTheme` with `cssVariables` and `colorSchemes` light + dark, default follows the system. JetBrains Mono for everything. Accent olive `#b4b96b` (primary; light mode uses a deeper `#7d8233` for contrast on white). Light: white background, text `#222`. Dark: background `#121212`, surfaces `#222`, text `#f5f5f5`. Status: success/warning/error from the theme; take B = info. Flat: no shadows, 1px dividers, pill buttons and chips, inputs radius 15. Headlines: uppercase, weight 800, two lines where the second line is in the accent color (`<TwoToneHeading first second />` in components/common).

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
Exported settings JSON (consumed by the Python tool): `{ basedOn, speechDbfs, noiseDbfs, gainHint, noiseHint, dist, lowcut, gate:{threshold,attack,hold,release,hysteresis,wet,dry}, eq:[{type:'Low Shelf'|'Band'|'High Shelf',freq,gain,bw,why}], comp:{threshold,ratio,attack,release,knee,wet,limit}, deess }`.

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

## Noisy-room mode (v0.2)
Goal: the best result a person can get in a bad room (servers, fans, AC, street) without changing the room. A bad room is the normal case, not an error.

**Diagnosis (audio/analyze.ts, audio/diagnose.ts).** From the existing silence window and speech spectra:
- `speechBands` / `noiseBands`: average power per BANDS entry (divide summed spectra by block count so both are on the same scale), `bandSnr = speechBands - noiseBands`.
- `tones`: peaks in the silence spectrum 90 Hz–8 kHz at least 8 dB above the local median (±1/3 octave), merged within 3 %, strongest first, max 6. Mains (50/60/100/120 Hz ±2 %) are reported by `hum`, not here.
- `noiseKind`: quiet (noise < -60 dBFS or SNR ≥ 30) · hum (strongest hum peak ≥ 10 dB and no strong tones) · tonal (≥ 1 tone ≥ 12 dB) · broadband.
- New checks: `tones` (warn ≥ 1 tone ≥ 12 dB; fix: notch suggestions + aim the back of the mic at the source) and `bandsnr` (bad when the voice bands 640 Hz–5 kHz average SNR < 15 dB, warn < 25).
- `bestControl` weights SNR more when the room is noisy: penalty `max(0, 40 - snr) / 2` becomes `max(0, 40 - snr)` when any control take has SNR < 25.

**Suggestions (settings/suggest.ts).** `noisyRoom = snr < 25`. Then:
- chain `['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate']` (quiet room: `['ReaGate', 'ReaEQ', 'ReaComp']`).
- `noiseReduction` = ReaFIR plan: add ReaFIR first; Mode **Subtract**; FFT size 4096; stay silent and tick **Automatically build noise profile** for ~3 s, then untick; start with the curve lowered so reduction ≈ 10–12 dB (stronger for SNR < 15) and back off if the voice turns watery/robotic. Alternatives: Elgato Noise Removal, Voice Focus (ai-coustics), NVIDIA Broadcast.
- ReaEQ: notches for each tone ≥ 12 dB (type Band, bw 0.1 oct, gain -6 to -12 dB by tone strength, max 3 notches); no boosts in bands whose `bandSnr` < 12 dB (clamp that band's gain to ≤ 0); high shelf capped at +2 dB; if the 5–16 kHz bands have SNR < 10, a high shelf of -2 to -4 dB instead.
- ReaComp: ratio 2.5, threshold `speechMed - 4`, makeup aims for -20 dBFS but never more than `-(noise after reduction) - 45` so the room is not pumped up.
- ReaGate as soft expander: threshold = estimated noise after reduction + 6 dB (estimate: `noise - 10`), dry -10 dB, hold 200 ms, release 300 ms.
- `noiseHint` stays; text/JSON include the chain, the ReaFIR steps and alternatives.

**UI.** Setup: live "Room" reading next to the meter while silent (quiet / some noise / noisy by level), and a placement tip built from the mic profile (cardioid: "point the back of the mic at the loudest noise source"; supercardioid: "put the noise at the mic's sides, ~125° off-axis"; omni/unknown: "move the mic closer to you and away from the noise, the pattern won't reject it"). Steps: same tip under the lead on control steps. Results: a "Room noise" panel (noise level and kind, tones list as chips, per-band SNR bars with 10/20 dB guides) and, when the session has a processed take, a "Before / after" card: SNR raw control (same distance) → processed, and voice-band SNR change. Suggested settings render the chain order and the ReaFIR steps as a numbered list.

**Tool.** No format change: notches are ordinary ReaEQ bands; ReaFIR is added and set up by hand.

## Generic mics + mic profile (v0.2)
The app is not tied to any mic. All copy is generic ("speak on-axis", "the mic", "the capsule"); no model names in UI text, checks or suggestions.
- `MicProfile` (types.ts): free-text model with a suggestion list (Fifine K688, Fifine K669, Shure SM58, Shure SM7B, Shure MV7, Rode PodMic, Rode NT-USB, Audio-Technica AT2020, AT2005USB, Blue Yeti, HyperX QuadCast, Elgato Wave:3, Samson Q2U, Maono PD200X, Other), kind, pattern, address. Picking a known model pre-fills kind/pattern/address (src/mics/catalog.ts); the person can change them.
- Setup screen: "Your microphone" card before the mic access card. Saved in localStorage `vcb-mic`. Copied onto every new take (`take.mic`).
- Advice that depends on the mic: address → "speak into the top" (end) vs "speak into the front side, where the logo is" (side) vs "point the capsule at your mouth" (unknown); pattern → placement tip (above); kind → condenser adds "condensers pick up more of the room: stay closer and lower the gain" to the noisy-room hint.
- Learning from people with the same model (later): each take stores `mic`, and Results offers "Copy anonymized summary" (JSON: mic profile, analysis numbers per take, suggestion values; no audio, no device names, no dates). How to aggregate (GitHub, a small API) is decided later.

## Community results via GitHub issues (v0.3)
Contract: `src/community/types.ts`. No server.
- **Share:** Results → "Share with the community" opens `https://github.com/<COMMUNITY_REPO>/issues/new?template=mic-result.yml&title=Mic result: <model>&summary=<minified CommunitySummary JSON>` in a new tab (issue form pre-fill by field id). The person reviews and submits with their own GitHub account; the page says that the issue is public. Disabled when the mic model is empty. If the URL would exceed ~7500 chars, round numbers harder / drop tones beyond 3 / drop rel then fall back to copy + open the blank form.
- **Issue form** `.github/ISSUE_TEMPLATE/mic-result.yml`: label `mic-result`; fields: summary (textarea, render json, required), notes (optional textarea: room, setup), consent checkbox ("I understand this issue is public").
- **Aggregation:** `src/community/aggregate.ts` (pure: parse issue bodies → valid CommunitySummary list → CommunityIndex; rejects malformed/out-of-range, dedupes identical summaries, ignores reports without a model) + `tools/community/aggregate.ts` (run with `npx tsx`; fetches issues with the label through the GitHub REST API using GITHUB_TOKEN when set, paginates, writes `public/community/mics.json`). GitHub Action `.github/workflows/community.yml`: on issues opened/edited/labeled + daily + manual; runs the script; commits the JSON if it changed.
- **Display:** the app fetches `${BASE_URL}community/mics.json` (fail soft). Setup "Your microphone" card: when the model matches, "N people with this mic: typical SNR …, best distance …". Results: a "People with this mic" card comparing your best raw control (SNR, deviations per band) with the community median, and their median EQ.

## Site pages (v0.4)
Contract: `Screen` in src/types.ts adds 'home' | 'how' | 'community' | 'privacy'; links in `src/site.ts`.
- **Routing:** hash routes, no router library. `#/` home · `#/how-it-works` · `#/community` · `#/privacy` · `#/check` (setup/step; the store's step decides) · `#/results`. `goTo` updates the hash; `hashchange`/load maps the hash to `goTo`. New visitors (no saved prefs) land on home; returning visitors with saved prefs and no hash keep their saved screen. Browser back/forward works between pages.
- **Top bar:** brand (click → home) · nav links How it works · Community · Privacy · primary pill "Start" (→ check; label "Continue" when a session has takes) · the progress stepper shows only on setup/step/results (second row on mobile).
- **Home:** overline "FREE · IN YOUR BROWSER · NOTHING UPLOADED", TwoToneHeading "Sound clearer" / "in the room you have", lead, primary "Start the 5-minute check →", text button "See an example result" (loads an in-memory demo session — synthetic takes, one noisy with fan tones, plus a processed take — not persisted, with a dismissible "Example data" banner on results and a "Start your own check" button), 4 step cards, 3 feature cards (Built for noisy rooms · Learn from your mic's owners · Private by default), compatibility line.
- **How it works:** sections: the four takes and why (distances, raw vs processed), what is measured (level, noise, SNR, tone balance vs reference, fan tones, per-band SNR, sibilance, consistency), the suggested chain and what each plugin does, applying settings (by hand / tools/apply-reaplugs.py), tips for bad rooms.
- **Community:** list of `mics.json` entries (model, reports, typical raw SNR, most voted distance, noisy-room share), search box, empty state, "How to share" + link to the issues list (`${repo}/issues?q=label:mic-result`).
- **Privacy:** what stays local (audio, takes in IndexedDB, prefs in localStorage; how to delete: Delete all), what a shared issue contains (public; mic profile + numbers + suggestion; no audio/device names/dates), how to remove a report (close the issue / remove the label / contact), no analytics, no cookies.
- **Footer (every page):** "Made by Vinicius Andrade" → andradev.io; icon links GitHub, LinkedIn, Stack Overflow, email (mailto shown as text too); "Source on GitHub" → repo; "Report an issue" → issues.

## Plain language (v0.5)
Audience: people who know nothing about audio. Every screen leads with plain words and actions; numbers and terms are optional detail.

**Message keys, not text.** Framework-free modules return `{ key: string; params?: Record<string, string | number> }` (type `Msg`, src/plain/types.ts). The UI renders them with i18n (v0.6). English source strings live in `src/i18n/locales/en.json`.
Engine text is `Msg` too (v0.6): `Check` has `titleMsg`/`valueMsg?`/`detailMsg`/`fixMsg?`; suggestion hints, ReaFIR steps, alternatives and EQ reasons, `failureHint`, mic tips and store status lines (`StatusMessage { msg, error }`) return keys under `engine.*` (`<locale>/engine.json`), numbers as params formatted in the string (`{{v, number(…)}}`); the downloaded .txt sheet and settings JSON stay English (`englishText`), "Copy as text" is localized.

**Clarity score (src/plain/score.ts)** — `clarityScore(a: Analysis): { score: number; main: 'noise' | 'level' | 'tone' | 'none' }`. Penalties, then `score = round(clamp(100 − Σ, 0, 100))`:
- noise: `clamp((30 − snr) × 1.5, 0, 45)`; +5 if any tone ≥ 12 dB or hum ≥ 12 dB.
- level: speech median outside [−26, −16] dBFS → `min(15, 2 × distance)`; clipping → +15.
- tone: `min(25, 1.2 × Σ_{bands 1..7} max(0, |dev| − 3))`.
- consistency: spread > 8 → `min(10, 1.5 × (spread − 8))`.
`main` = largest of noise / level / tone penalty (≥ 8), else 'none'.
Headline key by score: ≥ 85 `score.clear` ("Clear and clean") · 70–84 `score.good` ("Good — small things to polish") · 50–69 `score.ok.<main>` ("Understandable, but the room is loud" / "…but your volume needs fixing" / "…but your voice sounds a bit off") · < 50 `score.hard.<main>`. Plus a one-sentence explanation key per headline.

**Three everyday ratings (src/plain/ratings.ts)**, each `{ id, status: Status, label: Msg, explain: Msg }`:
- Background noise — snr ≥ 30 "Quiet" (good) · 20–30 "Noticeable" (warn) · < 20 "Loud" (bad); explain by noiseKind: tonal "A fan or machine is easy to hear." · hum "A low electrical hum is audible." · broadband "A steady hiss or room noise is audible." · quiet "Your pauses are clean."
- Your volume — "Good" · "Too quiet" · "Too loud" · "Distorting" (clipping) from the level/peaks checks.
- Sound of your voice — largest |deviation| over bands 1..8: ≤ 3 dB "Natural"; else by band and sign: boom/warmth high "Boomy" · mud high "Boxy" · body low "Hollow" · definition/presence low "Muffled" · presence high "Harsh" · sibilance high (or harsh S peaks) "Sharp S sounds" · sibilance+air low "Dull" · boom+warmth low "Thin"; prefix "A bit" for 3–6 dB, "Very" for > 6. Explain keys in everyday words ("Too much bass, a little muffled.").

**What to do next (src/plain/actions.ts)** — `nextActions(a, ctx): Action[]`, max 3, `{ id, text: Msg, cost: 'free' | 'minutes', impact: number, how?: 'settings' | 'placement' | 'gain' }`, sorted by impact desc, free before paid on ties, no duplicates:
- noisy (snr < 25): placement tip by mic pattern (impact = noise penalty), "Move closer: about one fist away" (only if best distance > current or not 2 cm), "Switch off fans or machines you can while recording", "Turn on noise reduction with our ready-made settings" (how: settings).
- level: too quiet "Turn the input volume (gain) up a little" · too loud/distorting "Turn the input volume (gain) down a little" (how: gain).
- tone: boomy "Back off a little — bass builds up when you're very close" · muffled "Speak straight into the mic" (address-aware) · sharp S "Angle the mic slightly off to the side of your mouth"; plus "Use our ready-made EQ settings" (how: settings) when tone penalty ≥ 8.
- hum: "Plug your audio interface into a different USB port (back of the computer)".

**Everyday distances:** 2 cm "about a finger's width" · 8 cm "about one fist" · 15 cm "about an open hand" — shown with the number.

**Glossary (src/plain/glossary.ts + `<Term id>` component):** gain, noise, SNR ("how much louder your voice is than the room"), dB, EQ, noise reduction, compressor, gate, sibilance, proximity effect, cardioid — one sentence + an everyday analogy each.

**Results layout:** score ring + headline + explanation → three rating cards → "What to do next" (each with "Show me how" opening the right panel: placement tips, the settings walk-through, or gain help) → collapsed "Show the technical details" containing everything that exists today. Steps/setup/pages use the same plain register (no unexplained jargon; numbers secondary).

## Languages and localization (v0.6)
i18next + react-i18next; locales `en` (source) and `pt-BR`; detection order: `?lang=` → saved choice (localStorage `vcb-lang`) → `navigator.languages` → en. Switcher in the top bar. Numbers/dates via `Intl` with the active locale (`-27,4 dBFS` in pt-BR); exported JSON and the Python tool stay locale-neutral. Plurals via i18next (`count`). Distances: cm, plus inches for `en-US`. Region setting (auto from locale, editable on setup): mains frequency 50 or 60 Hz — the hum check and hum advice use it. Reading passage per locale (original texts with plosives, sibilants and nasals; pt-BR keeps the current one). Product and plugin names and parameter labels (Wave Link, ReaFIR, Threshold, Ratio…) are never translated. Community data stays numeric and locale-free.

## Guided setup with interactive plugin replicas (v0.7)
Goal: show people exactly where to click and what to type, with their own values. No real screenshots of third-party software are shipped; panels are hand-built replicas (SVG/HTML + MUI) that mirror the layout and field names of the real windows.
- **"What do you use?"** (asked at the start of the guide, saved): Elgato Wave Link · OBS Studio · Discord / Teams / Zoom only · NVIDIA Broadcast · Not sure. Not sure → a short explainer and a recommendation (Wave Link users → Wave Link path; otherwise OBS or app-only path).
- **Wave Link + ReaPlugs path (first):** 1) open Wave Link → your mic → Effects (replica of the effects list with toggles, highlighting what to turn on/off and the order); 2) add a plugin (replica of "Add effect" → ReaPlugs entries); 3) one step per plugin in the suggested chain with a replica panel:
  - ReaFIR: mode dropdown = Subtract, FFT size = 4096, "Automatically build noise profile" checkbox with a 3-second "stay silent" cue, curve sketch showing the profile being lowered.
  - ReaEQ: graph with the person's actual response curve computed from the suggested bands (shelf/band/notch formulas), numbered band nodes, band tabs 1..N, fields Type / Frequency (Hz) / Gain (dB) / Bandwidth (oct) filled with the values; the current band highlighted.
  - ReaComp: Threshold slider + value, Ratio, Attack, Release, Knee size, Output mix Wet/Dry, "Limit output" checkbox.
  - ReaGate: Threshold, Attack, Hold, Release, Hysteresis, Wet/Dry.
  Each panel has numbered callouts (① click … ② type …) and a "Done, next" button; a checklist tracks progress; the alternative "apply automatically" path explains `tools/apply-reaplugs.py` (Wave Link closed).
- **OBS path (second):** Audio Mixer → ⋮ → Filters; built-in Noise Suppression (RNNoise), Expander/Noise Gate, 3-Band EQ, Compressor, Limiter with values mapped from the suggestion; option to load ReaPlugs VSTs via the "VST 2.x Plug-in" filter.
- **App-only path:** what to switch on/off in Discord/Teams/Zoom (noise suppression, echo cancellation, auto gain) + the free physical actions.
- Replicas are generic in style (theme colors, not Cockos/Elgato branding) but keep field names and order identical to the software so people recognise them. Plugin labels are never translated; surrounding text is.
- Reference for building the replicas: the real windows can be captured locally during development; captures are not committed.
- **Contract (v0.7):** route `#/guide` (Screen 'guide'); replica components live in `src/components/guide/replicas/` with props from `src/components/guide/replicas/types.ts`: `ReaEqPanel`, `ReaCompPanel`, `ReaGatePanel`, `ReaFirPanel`, `WaveLinkEffects` (named exports, one file each). Replica layouts (from the real windows): **ReaEQ** — response graph on top (log frequency grid 20 Hz–20 kHz, ±dB scale, numbered band nodes), a master gain slider on the right; band tabs 1..N under the graph; row: Enabled ☑, Type dropdown, "Log-scale automated frequencies" ☑; rows Frequency (Hz) slider + value field + note name, Gain (dB) slider + field, Bandwidth (oct) slider + field; buttons Add band · Remove band · Reset defaults; ☑ Show tabs ☑ Show grid ☐ Show phase. **ReaComp** — left: vertical Threshold slider with a dB field; Envelope group: Pre-comp, Attack, Release (sliders + ms fields), ☑ Classic attack ☐ Auto release, Ratio (:1), Knee size (dB); Detector input dropdown, Lowpass, Highpass, RMS size; middle: gain-reduction meter; right: Output mix Wet / Dry vertical sliders with fields, ☐ Preview filter ☐ Auto make-up, AA dropdown, ☑ Limit output. **ReaGate** — same family as ReaComp: Threshold vertical slider; Attack, Hold, Release, Pre-open; Hysteresis (dB); Detector input; Lowpass/Highpass; Output mix Wet / Dry (and Noise). **ReaFIR** — response graph (frequency vs dB) with the editable curve; Mode dropdown (EQ, Gate, Compressor, Subtract, Convolve), FFT size dropdown, Edit mode; ☐ "Automatically build noise profile (enable during silence)". **Wave Link** — the mic's Effects tab: list of effects with on/off toggles, settings (sliders) icon and delete per row, "+ Add effect" button; hardware Lowcut toggle with 80 Hz / 120 Hz. Replicas use theme colors (no vendor branding) and are approximate; verify against the real windows during development.

## Over-processing safety (v0.8)
Real case: following the noisy-room guide, ReaFIR set too strong produced a processed take 18 dB quieter, with the bass gone (−34 dB), harsh presence (+11), 40 % exact-zero samples and 46 gate flips in 20 s — and the app scored it 54 "quiet room" (noise −240 dBFS → SNR 197).
- **Analysis:** noise floor and frame levels are clamped at −100 dBFS (no −240), so SNR stays meaningful; new `zeroRatio` (share of samples inside runs of exact zeros ≥ 10 ms; isolated zeros from 16-bit quantization of a very quiet room don't count) and `gateSwitches` (zero runs ≥ 20 ms that start, per 10 s: each one is the processing slamming shut). Digital silence, not "quiet": a real room never trips them. New check `overprocessed`: bad when zeroRatio > 0.15 or gateSwitches > 12, warn when zeroRatio > 0.05 or gateSwitches > 6; fix: "Noise removal or the gate is too strong and is cutting your voice — reduce it".
- **Processed vs raw comparison** (plain module, used by results and score): when A is a processed take and a raw control of the same session exists, flag: level drop > 8 dB ("your voice got much quieter"), bass loss (boom+warmth deviation drop > 12 dB → "thin"), presence/sibilance rise > 6 dB ("harsh"), and over-processing. Clarity score of a processed take: noise penalty uses SNR capped at 45 and adds an over-processing penalty up to 35 (zeroRatio/gateSwitches) plus 10 per flagged regression; headline `score.overprocessed` ("Too much processing: it's cutting your voice"). Next actions put "turn noise removal down" first.
- **Suggestions:** ReaFIR reduction starts at about 6 dB ("drag the curve down a little — about 6 dB — then listen; stop at the first watery or robotic sound"), never "until the room drops 15 dB". `preferAi = snr < 15`: AI noise removal (Elgato Noise Removal, NVIDIA Broadcast, Voice Focus) is presented first and ReaFIR as the alternative. Gate dry stays −10 dB (never full silence). After noise reduction, a note to raise ReaComp Wet by the level lost (measured in the before/after).
- **Processed take distance:** the processed step records at the best control distance; the step and the guide say so explicitly ("same distance as your best take: 2 cm").

## Voice goals (v0.9)
People decide what "good" means for them. Nothing is judged against a single curve anymore.
- **Goal** `VoiceGoal = { style: 'natural' | 'warm' | 'clear' | 'bright'; perceived: PerceivedIssue[] }`, `PerceivedIssue = 'nasal' | 'muffled' | 'boomy' | 'thin' | 'harsh' | 'sharpS' | 'dull'`. Saved in localStorage `vcb-goal` (try/catch), editable on setup ("What do you want your voice to sound like?" + "How does your voice sound to you? (optional)") and on results ("Change goal" re-scores instantly; no re-recording).
- **Target curve:** `targetDeviations(rel, goal)` = deviations(rel) minus the style offset per band (dB; bands rumble, boom, warmth, mud, body, definition, presence, sibilance, air):
  - natural `[0, 0, 0, 0, 0, 0, 0, 0, 0]` (today's reference)
  - warm `[0, +3, +2, 0, +1, 0, -1, -1, -1]` (radio / podcast: more bass and body)
  - clear `[0, -1, -1, -1, 0, +2, +3, +1, +1]` (cuts through games and calls)
  - bright `[0, 0, -1, 0, 0, 0, +1, +2, +3]` (more sparkle on top)
  Same ±3 / ±6 dB tolerances around the target. Every consumer of deviations (diagnose band checks, plain ratings/score/actions, suggest EQ, bestControl, charts) takes the goal; charts label the zero line "your target".
- **Perceived issues** (what the person hears) combine with what is measured:
  - nasal ⇔ body (640 Hz–1.25 kHz) or definition (1.25–2.5 kHz) above target by > 1.5 dB · muffled ⇔ mud high or presence low · boomy ⇔ boom/warmth high · thin ⇔ boom+warmth low · harsh ⇔ presence high · sharpS ⇔ sibilance high or sibP95 > −6 · dull ⇔ sibilance+air low.
  - Confirmed by measurement → priority in "What to do next" and the full EQ correction; a new EQ band for nasal: Band ~1000 Hz (centre at the larger of body/definition excess), −2 to −4 dB, bw 1.0.
  - Not confirmed → an honest note ("We didn't measure this, but you hear it — here's a gentle tweak") and a gentle correction of 1.5 dB in that direction (never more), marked as "by ear".
- Community summaries add `goal.style` (not perceived) so stats can be split by style later.

## Profiles (v1.0)
The app builds and keeps the person's configuration.
- `Profile = { id, name, created, updated, mic: MicProfile, host: 'wavelink' | 'obs' | 'apps' | 'nvidia' | null, dist: string, goal: VoiceGoal, mains: 50 | 60 | 'auto', suggestion: SuggestionJson, devices?: DeviceChoice, validation: { rawScore, fxScore, snrGain, regressions: string[], date } | null, version: 1 }`. Stored in IndexedDB store `profiles` (same DB, version bump with migration) with in-memory fallback.
- **Create:** results → "Save as profile" (name suggested from host + style, e.g. "Wave Link · Warm"). Allowed only when a processed take beats the raw control: fxScore ≥ rawScore + 5, no over-processing regressions. Otherwise the button explains why and links to the guide ("fix first"). A draft can still be saved explicitly as "Not validated yet" (validation null, shown with a warning chip).
- **Profiles page** `#/profiles` (nav link): cards with name, mic, style, host, distance, validation chip (Validated · score raw → processed · date / Not validated), actions: Apply (guide with the profile's values; or the automatic tool), Re-test (starts a new session pre-set with the profile's devices, distance and goal; on completion offers to update the profile), Export (JSON file `voice-check-profile-<name>.json`), Duplicate, Rename, Delete (second-click confirm). Import button (file input; validated; never executes anything).
- **Tool:** `tools/apply-reaplugs.py` accepts a profile JSON (uses `.suggestion`) as well as the plain settings JSON.
- **Active profile:** one profile can be marked active; results compare new takes against it ("still matches your profile" / "your room changed: re-test").

### Profiles revision — Wave Link file round trip (supersedes the "Tool" bullet above)
Wave Link keeps all plugin states in `%LOCALAPPDATA%\Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json` (format in "Wave Link storage format"). The web app edits that file directly, in any browser:
1. **Upload** (file input; the page shows the exact path to paste into the file dialog). Validate it is a Wave Link settings file (MixerConfiguration.InputSettings with an input that has AudioPluginConfigurations) and pick the mic input (PCM_IN; let the person choose if several).
2. **Read current state:** decode every plugin on that input (ReaGate/ReaComp FxBk floats, ReaEQ FBCh bands, ReaFIR blob kept opaque, Elgato effects' BypassState) — TypeScript port of tools/apply-reaplugs.py, tested byte-identical on round trip against the real file (local `_test/wavelink-settings.json`, git-ignored).
3. **Preview the diff** in plain words + values ("ReaEQ: 4 bands → 6", "ReaComp Threshold −34 → −28 dB", "Turn off: Elgato EQ").
4. **Download** the adjusted `Settings.json` (only ParameterState/BypassState of the touched plugins change; formatting — CRLF, indent, .NET-style escaping — preserved) and, in the same click, the untouched original as `Settings.before-<date>.json`. Instructions: quit Wave Link from the tray icon, replace the file in that folder, start Wave Link. Undo = copy the backup back. Plugins missing from the input (e.g. ReaFIR never added) cannot be created from the browser: the preview lists them as "add this effect in Wave Link first, then upload again".
5. **Optional shortcut (Chrome/Edge):** File System Access API "Save directly" to the same handle, after the same backup download.
**Profiles** store the decoded plugin states (including the opaque ReaFIR blob once it has been configured in Wave Link) plus the suggestion/goal/validation data; applying a profile = upload the current file → download it with the profile's states. The Python tool stays for people who prefer it.

## Refinement loop (v1.1)
Real case: applying the suggestion made the take worse (35 → 0: 15 cm chosen as "best", gate −41 dB closing on the processed voice, ReaFIR too strong, bass cut twice, Wet +2 dB). The app must evaluate every applied setting and refine until it improves.
**Engine fixes (prerequisites):**
- bestControl in a noisy room (any control SNR < 25): SNR dominates — score = 0.5 × tone excess + 1.5 × max(0, 40 − snr); in quiet rooms unchanged. Real data (2 cm SNR 16.3 boomy, 15 cm SNR 7.9) must pick 2 cm.
- Gate with noise removal in the chain: threshold = round(clamp(speechMed − 30, −72, −45)), dry −10, hysteresis −6 (the gate sees the processed, quieter voice); without noise removal keep today's rule.
- bandSnr / noiseBands: noise band floor −100 dBFS-equivalent and bandSnr capped at 60 dB.
- Distance check: a processed take whose distance differs from `applied.dist` (or the suggestion base) gets a warning and is NOT used to judge the settings ("record at {{dist}} — the settings were made for that distance").
**Loop:**
- `applied` (store, localStorage `vcb-applied`): set by `markApplied` when the person downloads/saves an adjusted Wave Link file, applies a profile, or confirms "I applied these" at the end of the guide / suggested settings. Each new processed take copies `applied`.
- Evaluation of a processed take with `applied`: improved when fxScore ≥ rawScore + 5 and no regressions; else `refine(raw, fx, applied, goal): Refinement` (pure, src/plain/refine.ts):
  - chopped / zeroRatio > 0.05 → if noiseRemoval = reafir: switch to 'ai-elgato' (attempt ≥ 2) or "lower ReaFIR reduction by half" (attempt 1); gate: threshold − 10 dB (min −72) or dry 0 (gate off) if still chopped on a later attempt.
  - quieter (levelDrop ≥ 4) → comp wet += levelDrop (cap 18).
  - thin (bass loss) → move low shelf 150 Hz and the 250 Hz band toward 0 by the measured boom/warmth loss vs raw (never past 0 unless the goal wants more bass).
  - harsh → high shelf and 3.5 kHz band −(presence/sibilance rise × 0.7), min −4.
  - stillNoisy (fx SNR < raw SNR + 3 and no other regression) → stronger noise removal: reafir "about 3 dB more" or switch to AI.
  - wrongDistance → dist = base distance, no other change (re-record first).
  - changeApproach after 3 attempts without improvement: recommend AI noise removal + physical actions (placement, closer), stop tweaking numbers.
- **UI:** results for a processed take show an "Attempts" timeline (Attempt N: raw → fx score, ✓/✗) and, when not improved, a "Let's refine" card: the plain list of changes + "Apply refined settings to Wave Link" (dialog with the refined plan; marks applied with attempt+1) + guide link for by-hand changes + "Record again with effects" (goes to the fx step at `dist`). When improved: "It worked" + Save as profile. Copy plain, en + pt-BR.
