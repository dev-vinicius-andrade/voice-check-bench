# VST3 probe: can the Elgato Wave Link effects run outside Wave Link?

**Answer: yes.** All four Elgato VST3 effects load, instantiate, list their parameters, accept the exact state Wave Link stored, give it back byte for byte, and process audio offline in a plain Rust host. Nothing checks the host name, a licence or the Wave Link process. Noise Removal really removes noise: with its voice gate off, the noise floor drops 55 dB.

Spike date 2026-11-10 · Windows 11 Pro 26200 · Wave Link 3.4.0.4650 (running the whole time, never touched) · plugins loaded in place from `C:\Program Files\Common Files\VST3\Elgato\`, never copied.

## Language and SDK

The probe is in **Rust**, using the crate `vst3` 0.3.0 (coupler-rs, MIT/Apache). The crate ships pre-generated bindings, so neither libclang nor the C++ SDK is needed.

- `src/com.rs` (about 900 lines with `module.rs`): IHostApplication, IComponentHandler, a memory IBStream, IMessage/IAttributeList and IParameterChanges.
- `src/module.rs`: loads the DLL and its factory.
- Other crates: serde_json, base64, hound.

| Verdict | NoiseRemoval 1.1.2.113 | EQ 1.2.1.97 | De-Esser 1.0.1.127 | Compressor 1.0.1.95 |
|---|---|---|---|---|
| 1. Load, factory, create, initialize | PASS | PASS | PASS | PASS |
| 2. List parameters | PASS (3) | PASS (50) | PASS (13) | PASS (8) |
| 3. Apply the Wave Link state, read it back, compare bytes | PASS (identical) | PASS (identical) | PASS (identical) | n/a (not in Settings) |
| 4. Process audio offline | PASS (with conditions) | PASS | PASS | PASS |

## What Wave Link stores in ParameterState (Elgato VST3)

Wave Link is a JUCE host. `ParameterState` is the base64 of what JUCE `VST3PluginInstance::getStateInformation` returns:

```
'VC2!' + u32le(xml_len) + xml + '\0'                      (JUCE copyXmlToBinary)
xml = <VST3PluginState><IComponent>237.VMjLgTL....</IComponent></VST3PluginState>
<IComponent> text = JUCE MemoryBlock::toBase64Encoding ("<size>." + JUCE 6-bit alphabet, LSB first)
                    of exactly the bytes IComponent::getState wrote
```

- **Component state only.** There is no `<IEditController>`, because the Elgato controllers' `getState` returns kNotImplemented.
- **The component bytes have two parts.** First the plugin's own `VC2!` XML with plain values, e.g. `<PARAM id="VAD Threshold" value="0.44"/>`. Then a JUCE wrapper trailer, `JUCEPrivateData`, which holds the wrapper Bypass.
- **PluginId can be computed.** It is the JUCE `PluginDescription::uniqueId` of the "Audio Module Class": `h = h*31 + long`, run over the class id's four FUID longs. Computed ids match the three stored entries (f4a9d925, ef66d422, f3a0e81a); Compressor would be f664ec1f.
- **The codec round-trips exactly.** Decoding a stored string and encoding it again gives the same string, byte for byte.
- **Wave Link's built-in effects cannot be hosted.** VoiceFocus, WaveEQ, WaveCompressor, WaveExpander and SampleRecorder have `FilePath ""`.

## Step 1: load and instantiate (PASS ×4)

- Each plugin is a single-file `.vst3` DLL that exports InitDll, ExitDll and GetPluginFactory. They are built with JUCE and VST SDK 3.7.8.
- The host name doesn't matter: a neutral name and "Elgato Wave Link" give the same result.
- The plugins rewrite their own logs in `%APPDATA%\Elgato\VSTs\`. Wave Link's instances share those files.

## Step 2: parameters (PASS ×4)

| Plugin | Parameters |
|---|---|
| Noise Removal (3) | Bypass (773352680), VAD Threshold (1163972580, default 0.85), VAD Release (235314624) |
| EQ (50) | 8 bands × {Type, Frequency, Quality, Bypass, Gain, Visible}, plus wrapper Bypass and Program |
| De-Esser (13) | Two bands × {Frequency, Quality, Threshold, Ratio}, Attack, Release, tutorial flags, wrapper Bypass |
| Compressor (8) | Threshold, Gain reduction, Attack, Release, gain, Bypass, Auto make-up, wrapper Bypass |

## Step 3: apply the state, read it back, compare (PASS ×3)

The state is loaded with `IComponent::setState`. `setComponentState` returns kNotImplemented, but the parameters update anyway through `restartComponent`. Calling `getState` afterwards gives IDENTICAL bytes: Noise Removal 237 B, EQ 2632 B, De-Esser 773 B.

## Step 4: offline Noise Removal

Input: `_test/control-2-cm-raw.wav` (mono, 48 kHz, 19.9 s), processed in 480-sample blocks. Levels are percentiles of 50 ms frames; pauses are the quietest 20% of frames, speech the loudest 20%.

| Run | p10 | p50 | p90 | pauses | speech |
|---|---|---|---|---|---|
| input | −37.0 | −33.1 | −24.5 | | |
| stored state as is (plugin bypass On) | bit-identical to input | | | 0 dB | 0 dB |
| Bypass off (`out/nr.wav`) | digital silence | −38.5 | −25.1 | voice gate | −0.6 dB |
| Bypass off + VAD Threshold 0 (`out/nr-vad0.wav`) | −92.2 | −38.5 | −25.1 | −45.3 dB | −0.6 dB |

- **Cost:** about 120 µs per block, 1.2% of real time. EQ takes 11 µs, De-Esser 160 µs, Compressor 10 µs.
- **Latency is misreported.** The plugin reports 0, but the measured delay is 480 samples (10 ms) with 480-sample blocks, and 992 with 512-sample blocks.
- **The stored state has the plugin's own bypass On.** Wave Link's `BypassState` is false, yet the stored state plays as bit-exact pass-through.
- **Bypass needs a message loop.** After Bypass turns from On to Off, the change only takes effect once the host pumps the Win32 message queue for at least 80–120 ms. A fresh instance processes right away.

## What this means for the desktop app

1. **Live preview with Elgato's own plugins works.** No ReaFIR or RNNoise fallback is needed.
2. **Export is a pure codec.** Wrap `IComponent::getState` as described above, and compute the PluginId from the class id. A framework-free TypeScript codec could also edit the inner XML without hosting the plugin.
3. **Host requirements:**
   - plugins run on a thread with a Win32 message loop;
   - 48 kHz with 480-sample blocks;
   - compensate the 480-sample Noise Removal delay when comparing raw and processed side by side;
   - wait about 120 ms after a state load or bypass toggle.
4. **Bypass must be handled deliberately.** Write the wrapper bypass and `BypassState` consistently. It still needs checking in Wave Link which of the two it obeys.

## Open questions

- Not tested with Wave Link closed.
- For Noise Removal, `bypass=1.0` is stored while `BypassState=false`. Is it actually off in Wave Link right now?
- The plugin editors (IPlugView) were not tried.

## Reproduce

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"; cd spike/vst3-probe; cargo build --release
Copy-Item "$env:LOCALAPPDATA\Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json" out\Settings.copy.json
.\run-probe.ps1 ; .\run-probe.ps1 -HostName 'Elgato Wave Link'
.\target\release\vst3-probe.exe "C:\Program Files\Common Files\VST3\Elgato\ElgatoNoiseRemoval.vst3" --settings out\Settings.copy.json `
  --in ..\..\_test\control-2-cm-raw.wav --out out\nr.wav --block 480 --realtime --warmup-ms 200 --param 773352680=0 --extra-delay 480
python -I tools\lag.py ..\..\_test\control-2-cm-raw.wav out\nr.wav 300
```
