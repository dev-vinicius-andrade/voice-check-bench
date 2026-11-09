# Voice Check Bench

A local web app that records your voice in the browser, measures what makes it unclear (level, noise, hum, tone balance per octave, sibilance, consistency) and suggests ReaPlugs settings (ReaGate, ReaEQ, ReaComp, plus De-Esser and the Wave XLR lowcut) for Elgato Wave Link. A guided session compares raw takes at three mic distances with a take through your current Wave Link effects, and a small Python tool can write the suggested settings straight into Wave Link.

## Requirements

- Node.js 22 or newer
- Chrome or Edge (microphone recording via Web Audio)
- Python 3 (only for `tools/apply-reaplugs.py`; standard library only)
- For the processed take: Elgato Wave Link with its virtual "Record Mix" input

## Run

```sh
npm install
npm run dev
```

Open http://localhost:5173 and allow the microphone.

## Workflow

1. **Setup**: enable the microphone and pick two inputs: the raw mic (no effects, e.g. "Elgato Wave:XLR (Mic In)") for steps 1-3, and Wave Link's Record Mix ("Elgato Virtual Audio (Record Mix)") for step 4.
2. **Control takes**: read the text three times on the raw mic, at 2 cm, 8 cm and 15 cm. Each take starts with a few seconds of silence to measure the room.
3. **Processed take**: read the same text at your best distance through the Record Mix, so it includes your current Wave Link effects.
4. **Results**: see what to fix first, the per-octave tone balance against a reference, a comparison of all takes, the list of checks, and suggested ReaPlugs settings. Compare any two takes as A, B or A minus B.
5. **Export**: download the suggested settings as `.json` (or copy them as text and enter them by hand).
6. **Apply**: quit Wave Link from the tray, then run `python tools/apply-reaplugs.py <file>.json --write`. Set the Wave XLR lowcut by hand. See [tools/README.md](tools/README.md).

## Privacy

Recordings never leave your computer. Takes are stored in the browser (IndexedDB) and UI preferences in localStorage; there is no server, account or upload.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:5173 |
| `npm run build` | Typecheck and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript check only |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `python tools/apply-reaplugs.py --show` | Print the current ReaPlugs values from Wave Link |
| `python tools/apply-reaplugs.py --self-test` | Check the tool round-trips Wave Link's plugin data byte-identically |

## Hosting
The site is deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` (tests + build, then deploy). Custom domain: `voicecb.app.andradev.io` (`public/CNAME`). DNS: a `CNAME` record `voicecb.app` → `dev-vinicius-andrade.github.io`.
