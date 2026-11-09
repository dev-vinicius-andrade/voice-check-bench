# apply-reaplugs.py

Writes the ReaPlugs settings exported from Voice Check Bench (the `.json` download on the results page) into Elgato Wave Link, so you do not have to type them into each plugin window. Python 3, standard library only.

It changes, on one Wave Link input:
- **ReaGate**: threshold, attack, hold, release, hysteresis, wet, dry
- **ReaEQ**: replaces all bands with the suggested ones
- **ReaComp**: threshold, ratio, attack, release, wet, limit output
- **Elgato De-Esser**: on/off (bypass)

It does **not** change the Wave XLR hardware **Lowcut**. That is a device setting; set it by hand in Wave Link (the tool prints the value to use). The plugins must already be added to the input in Wave Link; the tool only edits existing plugins.

### Noisy rooms

When the voice is less than 25 dB over the room, the export has `"noisyRoom": true`, a `chain` (`ReaFIR → ReaEQ → ReaComp → ReaGate`) and a `noiseReduction` plan. The tool reads the EQ, compressor and gate values as usual and ignores these extra keys:
- **Notches** for fan/server tones are ordinary ReaEQ bands (`Band`, bandwidth 0.1 oct, -6 to -12 dB, at most 3, after the tonal bands). The tool writes them like any other band.
- **ReaFIR** (noise reduction) is set up **by hand**: its noise profile can't be written to Settings.json. In Wave Link → your mic → Effects, add "ReaFIR (ReaPlugs Edition)" and drag it to the top; Mode **Subtract**, FFT size 4096; stay silent and tick **Automatically build noise profile** for about 3 seconds, then untick it; drag the curve down until the room drops about 10–12 dB (about 15 dB when the voice is less than 15 dB over the room) and back off if the voice turns watery or robotic. The exact steps are in the `.txt` / Copy as text sheet.
- **Plugin order** is not changed by the tool. Put the plugins in the `chain` order by hand (ReaGate moves to the end, where it works as a soft expander).

## Where Wave Link stores settings

```
%LOCALAPPDATA%\Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json
```

Each plugin lives in `MixerConfiguration.InputSettings[<input>].AudioPluginConfigurations[]`. Its state is `ParameterState`: a base64 VST preset (FXP, magic `CcnK`). The tool uses the input whose key contains `PCM_IN` (the Wave XLR mic input) unless you pass `--input`.

| Plugin | FXP layout | Values |
|---|---|---|
| ReaGate | `FxBk` bank, 156-byte header, then one `FxCk` program: 56-byte header, then 19 big-endian float32 (normalized) | 0 threshold (linear amp) · 1 attack ms/500 · 2 release ms/5000 · 4 hold ms/1000 · 9 dry amp · 10 wet amp · 12 hysteresis amp |
| ReaComp | same as ReaGate | 0 threshold amp · 1 ratio (r-1)/99 · 2 attack ms/500 · 3 release ms/5000 · 11 wet amp · 17 limit output 0/1 |
| ReaEQ | `FBCh`, 156-byte header, big-endian int32 chunk size at offset 156, then a little-endian chunk | int32 version (33), int32 band count, per band: int32 type (0 low shelf, 1 high shelf, 8 band), int32 enabled, f64 freq Hz, f64 gain (linear), f64 bandwidth (octaves), u8 flag; then a 20-byte tail kept as is |

The FXP `byteSize` field (offset 4) is 0 in Wave Link's blobs; the tool keeps it 0 and only updates it when it is non-zero. The ReaEQ chunk size is updated when the band count changes.

## Usage

Run from the repository root (`python` or `py`, whichever runs Python 3 on your machine):

```sh
# Show the current ReaGate / ReaEQ / ReaComp / De-Esser values
python tools/apply-reaplugs.py --show

# Preview: show current and new values, write nothing
python tools/apply-reaplugs.py reaplugs-settings.json

# Apply (Wave Link must be closed, see Safety)
python tools/apply-reaplugs.py reaplugs-settings.json --write

# Check that decoding and re-encoding every ReaPlug is byte-identical (read-only)
python tools/apply-reaplugs.py --self-test
```

Options:
- `--settings PATH`: use another Settings.json (for example a copy to try things on). Default: the real Wave Link file.
- `--input TEXT`: pick the input whose key contains `TEXT` (case-insensitive) when more than one input has ReaPlugs. Default: the one containing `PCM_IN`.

`tools/example-settings.json` is a sample export you can preview against.

The settings file is checked before anything changes: required keys must be present, EQ types must be `Low Shelf`, `Band` or `High Shelf`, and values must be in sane ranges (gate threshold -100..0 dB, comp ratio 1..100, EQ frequency 20..20000 Hz, bandwidth 0.05..8 oct, and so on). Problems are listed and nothing is written.

## Safety

1. **Quit Wave Link from the tray icon** (right-click the icon, Quit) before `--write`. Closing the window is not enough: Wave Link keeps running and overwrites Settings.json when it exits. While `Elgato.WaveLink.exe` is running, `--write` refuses to touch the real file (a copy given with `--settings` is not checked).
2. Before writing, the tool runs the round-trip self-test and stops if it fails.
3. A **backup** is saved next to the file first: `Settings.before-voicecheck-<YYYYMMDD-HHMMSS>.json`.
4. The file is written back with its original formatting (CRLF line endings, 2-space indent, BOM only if there was one, Wave Link's string escaping), so only the changed `ParameterState` / `BypassState` values differ.
5. Start Wave Link again and open the plugin windows to check the values.

**To restore**: quit Wave Link from the tray, then copy the backup over `Settings.json`:

```powershell
cd "$env:LOCALAPPDATA\Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState"
Copy-Item Settings.before-voicecheck-<stamp>.json Settings.json
```

To try the tool without touching Wave Link at all, copy Settings.json somewhere else and pass `--settings <copy>`.

# Community results

People can share an anonymized result for their microphone, and the app shows what others with the same mic measured. There is no server: the results live in public GitHub issues and a GitHub Action turns them into a static file.

## How sharing works

1. On the results page, "Share with the community" opens the **Mic result** issue form (`.github/ISSUE_TEMPLATE/mic-result.yml`) with the Summary field already filled in.
2. The Summary is a `CommunitySummary` (`src/community/types.ts`): the mic profile (model, type, pattern, where you speak into it), the analysis numbers of the session's takes (levels, SNR, tone per band, room tones) and the suggested settings. No audio, device names, take names, dates or ids.
3. The person reviews it, ticks "I understand this issue is public" and submits with their own GitHub account. The issue gets the `mic-result` label.

## How the index is built

`tools/community/aggregate.ts` (`npm run community:aggregate`):

1. Fetches every issue labelled `mic-result` (open and closed) through the GitHub REST API, 100 per page. Pull requests are skipped. `GITHUB_TOKEN` is used when set (higher rate limit).
2. Reads the ```` ```json ```` block under `### Summary` in each issue body and checks it strictly (`src/community/validate.ts`): known keys only, allowed enums, numbers in sane ranges, 1–5 takes, at most 12 EQ bands. Anything malformed is ignored.
3. Aggregates (`src/community/aggregate.ts`): identical summaries count once; reports are grouped by the normalized model (`micKey`, so "Fifine K688" and "fifine-k688" are the same mic); reports with an empty model or without a raw control take (2/8/15 cm) are left out. Per mic: typical raw SNR and noise floor (median, 25th and 75th percentile), median tone deviation per band from each report's best raw control take, votes for the best distance, SNR gain of the processed take, median suggested EQ (notches excluded) and the share of noisy rooms.
4. Writes `public/community/mics.json` (the app fetches it as `community/mics.json`). When nothing but the timestamp would change, the file is left alone.

The workflow `.github/workflows/community.yml` runs the script when a `mic-result` issue is opened, edited, labelled, reopened or closed, once a day and on demand, and commits `public/community/mics.json` when it changed.

To drop a report from the stats, edit the issue's Summary, or remove the `mic-result` label and run the workflow again.

## Running locally

```sh
# From GitHub (unauthenticated: 60 requests per hour)
npm run community:aggregate

# With a token, or against a fork
GITHUB_TOKEN=... COMMUNITY_REPO=you/voice-check-bench npm run community:aggregate

# Offline: a JSON array of issue-like objects, e.g. [{ "body": "### Summary\n\n```json\n{...}\n```" }]
npm run community:aggregate -- --from-file issues.json
```

The script prints how many issues it read, how many summaries were valid and how many mics are in the index. Do not commit a `mics.json` built from test data.
