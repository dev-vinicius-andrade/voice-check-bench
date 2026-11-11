// WASAPI devices through cpal: list capture and render endpoints, pick the defaults (SPEC `audio`: the input named
// "Wave XLR"/"Mic In", the output named "Headphones", else the system default) and open them by id.
use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, DeviceDirection, DeviceId};
use serde::Serialize;

use super::error::{err, AudioErrorCode, AudioResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    /// cpal device id ("wasapi:…"), stable across runs; pass it back to `audio_start`.
    pub id: String,
    pub name: String,
    /// The Windows default device for its direction.
    pub is_system_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevices {
    pub inputs: Vec<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
    /// What `audio_start` opens when no input id is given.
    pub default_input_id: Option<String>,
    /// What `audio_start` opens when no output id is given.
    pub default_output_id: Option<String>,
}

/// Lowercase letters and digits only: "Mic In (2- Elgato Wave:XLR)" → "micin2elgatowavexlr".
fn norm(s: &str) -> String {
    s.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// The device whose name contains one of `needles` (normalized). Ties: more needles matched, then the system
/// default, then list order. Falls back to the system default, then to the first device.
fn pick<'a>(devices: &'a [AudioDevice], needles: &[&str]) -> Option<&'a AudioDevice> {
    let score = |d: &AudioDevice| {
        let n = norm(&d.name);
        needles.iter().filter(|w| n.contains(&norm(w))).count()
    };
    let best = devices
        .iter()
        .enumerate()
        .filter(|(_, d)| score(d) > 0)
        .max_by_key(|(i, d)| (score(d), d.is_system_default, usize::MAX - i))
        .map(|(_, d)| d);
    best.or_else(|| devices.iter().find(|d| d.is_system_default))
        .or_else(|| devices.first())
}

pub fn pick_input(devices: &[AudioDevice]) -> Option<&AudioDevice> {
    pick(devices, &["Wave XLR", "Mic In"])
}

pub fn pick_output(devices: &[AudioDevice]) -> Option<&AudioDevice> {
    pick(devices, &["Headphones"])
}

fn describe(d: &Device, default_id: &Option<DeviceId>) -> Option<AudioDevice> {
    let id = d.id().ok()?;
    let name = d
        .description()
        .map(|x| x.name().to_string())
        .unwrap_or_else(|_| d.to_string());
    Some(AudioDevice {
        is_system_default: default_id.as_ref() == Some(&id),
        id: id.to_string(),
        name,
    })
}

/// Capture endpoints are inputs and render endpoints outputs. (cpal also offers render endpoints as inputs, which
/// is WASAPI loopback; they are left out.)
fn direction_of(d: &Device) -> (bool, bool) {
    match d.description().map(|x| x.direction()) {
        Ok(DeviceDirection::Input) => (true, false),
        Ok(DeviceDirection::Output) => (false, true),
        Ok(DeviceDirection::Duplex) => (true, true),
        _ => (d.supports_input(), d.supports_output()),
    }
}

/// A cpal device with its description.
type Found = Vec<(Device, AudioDevice)>;

/// (inputs, outputs).
fn enumerate() -> AudioResult<(Found, Found)> {
    let host = cpal::default_host();
    let def_in = host.default_input_device().and_then(|d| d.id().ok());
    let def_out = host.default_output_device().and_then(|d| d.id().ok());
    let all = host.devices().or_else(|e| {
        err(
            AudioErrorCode::NoDevice,
            format!("cannot list audio devices: {e}"),
        )
    })?;
    let (mut ins, mut outs) = (vec![], vec![]);
    for d in all {
        let (is_in, is_out) = direction_of(&d);
        if is_in {
            if let Some(info) = describe(&d, &def_in) {
                ins.push((d.clone(), info));
            }
        }
        if is_out {
            if let Some(info) = describe(&d, &def_out) {
                outs.push((d, info));
            }
        }
    }
    Ok((ins, outs))
}

pub fn list() -> AudioResult<AudioDevices> {
    let (ins, outs) = enumerate()?;
    let inputs: Vec<AudioDevice> = ins.into_iter().map(|(_, i)| i).collect();
    let outputs: Vec<AudioDevice> = outs.into_iter().map(|(_, i)| i).collect();
    Ok(AudioDevices {
        default_input_id: pick_input(&inputs).map(|d| d.id.clone()),
        default_output_id: pick_output(&outputs).map(|d| d.id.clone()),
        inputs,
        outputs,
    })
}

/// The device with `id`, or the default pick when `id` is `None`.
pub(crate) fn open(id: Option<&str>, input: bool) -> AudioResult<(Device, AudioDevice)> {
    let (ins, outs) = enumerate()?;
    let list = if input { ins } else { outs };
    let what = if input { "input" } else { "output" };
    let infos: Vec<AudioDevice> = list.iter().map(|(_, i)| i.clone()).collect();
    let want = match id {
        Some(id) => id.to_string(),
        None => match if input {
            pick_input(&infos)
        } else {
            pick_output(&infos)
        } {
            Some(d) => d.id.clone(),
            None => return err(AudioErrorCode::NoDevice, format!("no {what} device")),
        },
    };
    list.into_iter().find(|(_, i)| i.id == want).ok_or_else(|| {
        super::error::AudioError::new(
            AudioErrorCode::DeviceNotFound,
            format!("no {what} device with id {want}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev(name: &str, default: bool) -> AudioDevice {
        AudioDevice {
            id: format!("wasapi:{name}"),
            name: name.into(),
            is_system_default: default,
        }
    }

    #[test]
    fn input_prefers_the_wave_xlr_mic() {
        let list = vec![
            dev("Microphone (Webcam)", true),
            dev("Wave Link Stream", false),
            dev("Mic In (2- Elgato Wave:XLR)", false),
        ];
        assert_eq!(
            pick_input(&list).unwrap().name,
            "Mic In (2- Elgato Wave:XLR)"
        );
    }

    #[test]
    fn input_matches_either_name() {
        let list = vec![dev("Microphone (Webcam)", true), dev("Mic In (USB)", false)];
        assert_eq!(pick_input(&list).unwrap().name, "Mic In (USB)");
        let list = vec![dev("Line (Elgato Wave XLR)", false), dev("Mic", true)];
        assert_eq!(pick_input(&list).unwrap().name, "Line (Elgato Wave XLR)");
    }

    #[test]
    fn falls_back_to_the_system_default_then_the_first() {
        let list = vec![dev("A", false), dev("Microphone (Webcam)", true)];
        assert_eq!(pick_input(&list).unwrap().name, "Microphone (Webcam)");
        let list = vec![dev("A", false), dev("B", false)];
        assert_eq!(pick_output(&list).unwrap().name, "A");
        assert!(pick_output(&[]).is_none());
    }

    #[test]
    fn output_prefers_headphones() {
        let list = vec![
            dev("Speakers (Realtek)", true),
            dev("Headphones (2- Elgato Wave:XLR)", false),
        ];
        assert_eq!(
            pick_output(&list).unwrap().name,
            "Headphones (2- Elgato Wave:XLR)"
        );
        let list = vec![dev("Headphones (BT)", false), dev("Headphones (USB)", true)];
        assert_eq!(
            pick_output(&list).unwrap().name,
            "Headphones (USB)",
            "the system default wins a tie"
        );
    }
}
