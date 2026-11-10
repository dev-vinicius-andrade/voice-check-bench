//! Wave Link `ParameterState` codec for VST3 plugins. Port of `spike/vst3-probe/src/state.rs`.
//!
//! Wave Link hosts VST3 effects through JUCE's `VST3PluginInstance`; its `getStateInformation` is stored base64
//! (standard alphabet) in Settings.json:
//!   `'VC2!' + u32le(xml_len) + xml + '\0'`                         (JUCE AudioProcessor::copyXmlToBinary)
//!   `xml = <?xml version="1.0" encoding="UTF-8"?> <VST3PluginState><IComponent>N.juce64</IComponent>
//!          [<IEditController>N.juce64</IEditController>]</VST3PluginState>` (one line)
//!   `N.juce64` = JUCE MemoryBlock::toBase64Encoding (byte count, '.', 6-bit alphabet, LSB first) of the bytes
//!   IComponent::getState / IEditController::getState wrote.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::host::HostResult;

const TABLE: &[u8; 64] = b".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+";
const MAGIC: &[u8; 4] = b"VC2!";

pub fn juce_b64_decode(s: &str) -> HostResult<Vec<u8>> {
    let (size, data) = s.split_once('.').ok_or("JUCE base64: no '.'")?;
    let size: usize = size
        .trim()
        .parse()
        .map_err(|e| format!("JUCE base64 size: {e}"))?;
    if data.len() * 6 < size * 8 {
        return Err(format!("JUCE base64: {} chars cannot hold {size} bytes", data.len()).into());
    }
    let mut out = vec![0u8; size];
    for (i, ch) in data.bytes().enumerate() {
        let v = TABLE
            .iter()
            .position(|c| *c == ch)
            .ok_or_else(|| format!("JUCE base64: bad char {ch}"))? as u32;
        for b in 0..6 {
            let pos = i * 6 + b;
            if pos / 8 >= size {
                break;
            }
            if v & (1 << b) != 0 {
                out[pos / 8] |= 1 << (pos % 8);
            }
        }
    }
    Ok(out)
}

pub fn juce_b64_encode(b: &[u8]) -> String {
    let n = (b.len() * 8).div_ceil(6);
    let mut s = format!("{}.", b.len());
    for i in 0..n {
        let mut v = 0usize;
        for k in 0..6 {
            let pos = i * 6 + k;
            if pos / 8 < b.len() && (b[pos / 8] >> (pos % 8)) & 1 == 1 {
                v |= 1 << k;
            }
        }
        s.push(TABLE[v] as char);
    }
    s
}

#[derive(Debug, Clone, PartialEq)]
pub struct WaveLinkState {
    pub component: Option<Vec<u8>>,
    pub controller: Option<Vec<u8>>,
}

fn tag_text<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let a = xml.find(&open)? + open.len();
    let b = xml[a..].find(&close)? + a;
    Some(&xml[a..b])
}

/// Decode the base64 `ParameterState` string from Settings.json.
pub fn decode_parameter_state(b64: &str) -> HostResult<WaveLinkState> {
    let raw = STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("ParameterState base64: {e}"))?;
    if raw.len() < 9 || &raw[..4] != MAGIC {
        return Err("ParameterState is not a JUCE 'VC2!' XML blob".into());
    }
    let n = u32::from_le_bytes([raw[4], raw[5], raw[6], raw[7]]) as usize;
    if 8 + n > raw.len() {
        return Err("VC2! length field exceeds the blob".into());
    }
    let xml = std::str::from_utf8(&raw[8..8 + n]).map_err(|e| format!("VC2! xml utf8: {e}"))?;
    let component = tag_text(xml, "IComponent")
        .map(juce_b64_decode)
        .transpose()?;
    let controller = tag_text(xml, "IEditController")
        .map(juce_b64_decode)
        .transpose()?;
    Ok(WaveLinkState {
        component,
        controller,
    })
}

/// Build the base64 `ParameterState` exactly as Wave Link (JUCE VST3PluginInstance::getStateInformation) does.
pub fn encode_parameter_state(component: Option<&[u8]>, controller: Option<&[u8]>) -> String {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?> <VST3PluginState>");
    if let Some(c) = component {
        xml.push_str(&format!("<IComponent>{}</IComponent>", juce_b64_encode(c)));
    }
    if let Some(c) = controller {
        xml.push_str(&format!(
            "<IEditController>{}</IEditController>",
            juce_b64_encode(c)
        ));
    }
    xml.push_str("</VST3PluginState>");
    let mut raw = Vec::with_capacity(xml.len() + 9);
    raw.extend_from_slice(MAGIC);
    raw.extend_from_slice(&(xml.len() as u32).to_le_bytes());
    raw.extend_from_slice(xml.as_bytes());
    raw.push(0);
    STANDARD.encode(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn juce_base64_known_vectors() {
        assert_eq!(juce_b64_encode(&[]), "0.");
        // "1" + '.' separator + two zero chars ('.' is digit 0)
        assert_eq!(juce_b64_encode(&[0x00]), "1...");
        // 0xFF: bits 0..5 = 63 → '+', bits 6..7 = 3 → 'C'
        assert_eq!(juce_b64_encode(&[0xFF]), "1.+C");
        // 0x01 0x00 0x00: first 6 bits = 1 → 'A', the rest zero → 4 chars total
        assert_eq!(juce_b64_encode(&[1, 0, 0]), "3.A...");
        assert_eq!(juce_b64_decode("1.+C").unwrap(), vec![0xFF]);
        assert_eq!(juce_b64_decode("3.A...").unwrap(), vec![1, 0, 0]);
    }

    #[test]
    fn juce_base64_round_trips_every_length() {
        let mut seed = 0x1234_5678u32;
        for len in 0..70 {
            let b: Vec<u8> = (0..len)
                .map(|_| {
                    seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    (seed >> 24) as u8
                })
                .collect();
            let s = juce_b64_encode(&b);
            assert!(s.starts_with(&format!("{len}.")));
            assert_eq!(juce_b64_decode(&s).unwrap(), b, "len {len}");
        }
    }

    #[test]
    fn juce_base64_rejects_garbage() {
        assert!(juce_b64_decode("no-dot").is_err());
        assert!(juce_b64_decode("x.AB").is_err());
        assert!(juce_b64_decode("2.A!").is_err());
        assert!(juce_b64_decode("9.AB").is_err(), "too short for the size");
    }

    /// A synthetic component state shaped like a JUCE plugin's: its own VC2! XML plus a wrapper trailer.
    fn synthetic_component() -> Vec<u8> {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?> <Params><PARAM id="bypass" value="1.0"/></Params>"#;
        let mut b = b"VC2!".to_vec();
        b.extend_from_slice(&(xml.len() as u32).to_le_bytes());
        b.extend_from_slice(xml.as_bytes());
        b.push(0);
        b.extend_from_slice(b"JUCEPrivateData\x00\x01\x02\x03");
        b
    }

    #[test]
    fn parameter_state_round_trip() {
        let comp = synthetic_component();
        let s = encode_parameter_state(Some(&comp), None);
        let raw = STANDARD.decode(&s).unwrap();
        assert_eq!(&raw[..4], b"VC2!");
        assert_eq!(
            *raw.last().unwrap(),
            0,
            "NUL-terminated like copyXmlToBinary"
        );
        let xml_len = u32::from_le_bytes([raw[4], raw[5], raw[6], raw[7]]) as usize;
        assert_eq!(raw.len(), 8 + xml_len + 1);
        let xml = std::str::from_utf8(&raw[8..8 + xml_len]).unwrap();
        assert!(xml.starts_with(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?> <VST3PluginState><IComponent>"
        ));
        assert!(!xml.contains("IEditController"));
        let d = decode_parameter_state(&s).unwrap();
        assert_eq!(
            d,
            WaveLinkState {
                component: Some(comp.clone()),
                controller: None
            }
        );
        // decode → encode gives the same string byte for byte
        assert_eq!(
            encode_parameter_state(d.component.as_deref(), d.controller.as_deref()),
            s
        );

        let with_ctrl = encode_parameter_state(Some(&comp), Some(&[9, 8, 7]));
        let d = decode_parameter_state(&with_ctrl).unwrap();
        assert_eq!(d.controller, Some(vec![9, 8, 7]));
        assert_eq!(
            encode_parameter_state(d.component.as_deref(), d.controller.as_deref()),
            with_ctrl
        );
    }

    #[test]
    fn parameter_state_rejects_other_formats() {
        assert!(decode_parameter_state("not base64!").is_err());
        assert!(decode_parameter_state(&STANDARD.encode(b"CcnK0000000000")).is_err());
        let mut raw = b"VC2!".to_vec();
        raw.extend_from_slice(&1000u32.to_le_bytes());
        raw.extend_from_slice(b"<x/>");
        assert!(decode_parameter_state(&STANDARD.encode(raw)).is_err());
    }
}
