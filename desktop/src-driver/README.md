# VCB Virtual Audio Capture Driver

A Windows kernel-mode audio capture endpoint that reads processed audio from the Voice Check Bench desktop app via shared memory, exposing it as a system-wide virtual microphone ("Voice Check Bench Mic") selectable in Zoom, Teams, Discord, OBS, and any other audio application.

## Architecture

```
Windows App (Zoom/Teams/Discord/OBS)
    │ WASAPI capture
    ▼
Kernel: vcb_capture.sys (AVStream WaveRT miniport)
    │ Shared memory ring buffer (vcb_ring.h)
    ▲
User-mode: Voice Check Bench desktop app
    - Captures real mic via cpal/WASAPI
    - Processes through ReaPlugs chain (VST2/VST3)
    - Writes processed mono blocks to ring buffer
```

## Prerequisites

- **Visual Studio 2022+** with C++ Desktop Development and Windows Driver Kit (WDK) components
- **Windows SDK** matching your WDK version
- **Administrator privileges** for driver installation and test signing
- **Voice Check Bench desktop app** running (creates the shared memory section)

## Building

Open an elevated Developer Command Prompt:

```powershell
cd desktop\src-driver
.\build.ps1 -Configuration Release -Sign
```

Or build manually via Visual Studio: open `vcb_capture.vcxproj`, select Release|x64, and build.

## Installation

1. Enable test signing (one-time, requires reboot):
   ```
   bcdedit /set TESTSIGNING ON
   ```

2. Install the driver:
   ```
   devcon install vcb_capture.inf Root\VCB_Capture
   ```

3. Verify: Open Windows Sound → Recording tab → "Voice Check Bench Mic" should appear.

4. Start the Voice Check Bench desktop app to begin processing audio through the virtual mic.

## Uninstallation

```
devcon remove Root\VCB_Capture
```

## Source Files

| File | Purpose |
|------|---------|
| `vcb_ring.h` | Shared-memory ring buffer interface (lock-free SPSC, 64-block capacity at 48kHz/480 samples) |
| `vcb_common.h` | Common header: GUIDs, pool tags, format constants, SHM context struct |
| `vcb_shm.cpp` | Kernel-mode shared memory reader (DISPATCH_LEVEL safe, atomic operations only) |
| `adapter.cpp` | DriverEntry, WDF device add, shared memory init/cleanup on PnP events |
| `minwavert.cpp` | WaveRT miniport: pin descriptors, stream factory, filter descriptor |
| `minwavertstream.h/.cpp` | Capture stream: DMA buffer management, timer callback, **WriteBytes() ring buffer integration** |
| `vcb_wavtable.cpp` | Format descriptors: 48kHz / 32-bit IEEE Float / Mono |
| `vcb_capture.inf` | Driver installation INF for Windows 10/11 x64 |
| `vcb_capture.vcxproj` | MSBuild/WDK project file |
| `build.ps1` | Build + optional test-sign script |

## Latency Budget

| Stage | Samples | ms |
|-------|---------|-----|
| Real mic capture (cpal shared-mode) | 480 | 10 |
| ReaPlugs processing (per block) | 480 | 10 |
| Kernel-user ring buffer crossing | ~96 | ~2 |
| Virtual endpoint buffering | 480 | 10 |
| **Total (mic-to-app)** | **~1536** | **~32** |

## Production Signing

For distribution outside test environments:
- **Alpha/Beta**: Attestation signing via Microsoft Partner Center
- **Production**: WHQL certification for the kernel driver; EV code signing for user-mode components

## License

Driver code is part of the Voice Check Bench project. Based on Microsoft sysvad sample architecture (MIT).