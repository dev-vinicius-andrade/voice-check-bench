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
