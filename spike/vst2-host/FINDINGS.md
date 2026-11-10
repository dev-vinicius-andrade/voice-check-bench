# VST2 host spike: ReaPlugs state, processing, live latency, raw mic

Spike date: 2026-11-10. Windows 11, Wave Link 3.4 running and never touched. Settings.json was only read: its last write is 11:10:49, before the spike.

| Risk | Verdict |
|---|---|
| 1. State round trip | PASS for ReaGate, ReaComp and ReaEQ (byte-identical). PARTIAL for ReaFIR (1 byte shorter, same sound). |
| 2. Offline processing | PASS |
| 3. Live latency | PASS on CPU. PARTIAL on latency: about 46–54 ms, plus 85 ms when ReaFIR is in the chain. |
| 4. Raw mic while Wave Link runs | PASS |

## 1. State round trip
- `ParameterState` is the base64 of a JUCE-written bank file: byteSize 0, version 1, fxVersion 1100, numPrograms 1.
- ReaGate and ReaComp do not use chunks. Their state is a bank of 19 big-endian floats, set with `setParameter` and read back with `getParameter`.
- ReaEQ and ReaFIR use chunks: a 156-byte header, then the chunk size, then the bytes of `effGetChunk(0)`.
- Our export is byte-identical to what Wave Link stored for ReaGate (288 B), ReaComp (288 B) and ReaEQ (485 B). Re-checked by the orchestrator with `cargo run --release -- state`.
- ReaFIR exports 8540 B instead of 8541. The plugin re-encodes its noise profile differently every time it saves. Two exports from the same instance are identical, and the audio differs by at most 7.4e-7 (about −123 dB). So ReaFIR states must be compared by parameters or by sound, never by bytes.
- Changing values works:
  - ReaComp Wet +18 → +12 dB changes only bytes 257..260.
  - ReaEQ band 3 → −3 dB shows up in the chunk.
  - Both edits were written to `out/Settings.modified.json` (a copy). `apply-reaplugs.py --show` reads them back, and the TypeScript codec agrees (`scripts/decode-ts.ts`).
- After loading a chunk, ReaEQ changes its `numParams` from 12 to 27 without telling the host. Re-read the parameters after every state load.

## 2. Offline processing
The chain ReaFIR → ReaEQ → ReaComp → ReaGate on `_test/control-2-cm-raw.wav`, with 480-sample blocks:

| Stage | RMS | Peak |
|---|---|---|
| Raw | −28.7 | −7.9 |
| after ReaFIR | −31.8 | −9.5 |
| after ReaEQ | −33.0 | −11.5 |
| after ReaComp | −15.4 | 0.0 |
| after ReaGate | −9.4 | **+6.0** |

- ReaFIR delays the signal by 4096 samples (85.3 ms).
- **The stored ReaGate has Dry 0 dB and Wet 0 dB.** The dry and gated signals are added together, so while the gate is open the voice is **+6 dB louder**. That clips after ReaComp, which already peaks at 0 dBFS. This matches the user's "effects too strong" take. The web app's refine logic assumes Dry 0 dB means the gate "lets everything through", which is wrong: it is a +6 dB sum.
- With Dry off and the threshold at −15 dB, 33 % of the samples become exact zeros, so the gate works.
- The chain costs 30.8 µs per 10 ms block at the median (0.3 % of real time), 882 µs at worst.

## 3. Live latency
- WASAPI shared mode, through cpal, uses a fixed 480-frame (10 ms) period on every endpoint. IAudioClient3 reports 480 as both the minimum and the maximum.
- A 60 s silent run: chain median 45.5 µs, p99 602 µs, max 1.26 ms. No underruns and no dropped buffers.
- From capture to playback: median 54 ms (44–64), plus 85 ms with ReaFIR. A hand-written WASAPI loop might reach 25–35 ms.

## 4. Raw mic while Wave Link runs
These all open in shared mode while Wave Link runs:
- `Mic In (2- Elgato Wave:XLR)`: the raw mic. 2 channels (the mono mic duplicated), 48 kHz, float32, room noise −25.7 dBFS RMS.
- The Personal, Stream and Record Mix captures. Record Mix carries the processed mic.
- `Headphones (2- Elgato Wave:XLR)` as loopback.

## What changes the desktop-app design
- Export is solved: write the same bank layout Wave Link uses.
- Compare ReaFIR states by parameters or sound, not by bytes.
- Re-read the parameter list after every state load.
- Users hear Wave Link's processed mic and the app's preview at the same time, so the app must tell them to mute the mic in Wave Link's monitor mix while previewing.
- The real chain also includes Elgato Noise Removal (VST3, see `../vst3-probe/FINDINGS.md`). The app must host VST2 and VST3 together.
- Gate settings must use Dry = off (−inf), never 0 dB.

## Hear it yourself
Use headphones, and mute the mic in Wave Link's monitor mix first.
```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"; cd spike/vst2-host
cargo run --release -- devices
cargo run --release -- live --in "Mic In" --out "Headphones" --gain 0.3 --seconds 60
cargo run --release -- live --in "Mic In" --out "Headphones" --gain 0.3 --seconds 60 --only ReaEQ,ReaComp,ReaGate
cargo run --release -- live --in "Mic In" --out "Headphones" --gain 0.3 --seconds 60 --set "ReaGate:9=0;ReaGate:0=0.01"
```
Start at gain 0.3, because the stored chain peaks at +6 dBFS.
