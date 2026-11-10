// WASAPI engine periods per endpoint (IAudioClient3), to see how far below cpal's fixed 10 ms shared-mode period a
// low-latency shared stream (InitializeSharedAudioStream) could go. Streams are initialized but never started.
use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};
use windows::Win32::Media::Audio::{IAudioClient3, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree};
use windows::core::HSTRING;

pub fn periods() -> Result<()> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        println!("frames @48k: default / fundamental / min / max engine period; then InitializeSharedAudioStream(min) result");
        for d in cpal::default_host().devices()? {
            let id = d.id()?;
            let dev = en.GetDevice(&HSTRING::from(id.id()))?;
            let ac: IAudioClient3 = match dev.Activate(CLSCTX_ALL, None) {
                Ok(a) => a,
                Err(e) => {
                    println!("{d}: IAudioClient3 not available ({e})");
                    continue;
                }
            };
            let fmt = ac.GetMixFormat()?;
            let (mut def, mut fun, mut min, mut max) = (0u32, 0u32, 0u32, 0u32);
            let r = ac.GetSharedModeEnginePeriod(fmt, &mut def, &mut fun, &mut min, &mut max);
            let mut cur = 0u32;
            let mut curfmt = std::ptr::null_mut();
            let rc = ac.GetCurrentSharedModeEnginePeriod(&mut curfmt, &mut cur);
            if !curfmt.is_null() {
                CoTaskMemFree(Some(curfmt as _));
            }
            // Try a low-latency shared stream with the minimum period (initialized, never started: no audio).
            let init = if r.is_ok() && min > 0 {
                let ac2: IAudioClient3 = dev.Activate(CLSCTX_ALL, None)?;
                match ac2.InitializeSharedAudioStream(0, min, fmt, None) {
                    Ok(()) => {
                        let mut c2 = 0u32;
                        let mut f2 = std::ptr::null_mut();
                        let _ = ac2.GetCurrentSharedModeEnginePeriod(&mut f2, &mut c2);
                        if !f2.is_null() {
                            CoTaskMemFree(Some(f2 as _));
                        }
                        let lat = ac2.GetStreamLatency().unwrap_or(0);
                        let buf = ac2.GetBufferSize().unwrap_or(0);
                        format!("OK, current engine period now {c2} frames, buffer {buf} frames, stream latency {:.2} ms", lat as f64 / 1e4)
                    }
                    Err(e) => format!("failed: {e}"),
                }
            } else {
                "-".into()
            };
            CoTaskMemFree(Some(fmt as _));
            match r {
                Ok(()) => println!(
                    "{d}: {def} / {fun} / {min} / {max}; current {} -> {init}",
                    if rc.is_ok() { cur.to_string() } else { "?".into() }
                ),
                Err(e) => println!("{d}: GetSharedModeEnginePeriod failed: {e}"),
            }
        }
    }
    Ok(())
}
