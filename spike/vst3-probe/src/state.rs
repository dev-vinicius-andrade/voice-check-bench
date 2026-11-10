//! Wave Link `ParameterState` codec for VST3 plugins.
//!
//! Wave Link hosts VST3 effects through JUCE's `VST3PluginInstance`, whose `getStateInformation` is stored
//! base64 (standard alphabet) in Settings.json:
//!   'VC2!' + u32le(xml_len) + xml + '\0'                          (JUCE AudioProcessor::copyXmlToBinary)
//!   xml = `<?xml version="1.0" encoding="UTF-8"?> <VST3PluginState><IComponent>N.juce64</IComponent>
//!          [<IEditController>N.juce64</IEditController>]</VST3PluginState>`  (one line, JUCE singleLine format)
//!   N.juce64 = JUCE MemoryBlock::toBase64Encoding of the bytes IComponent::getState / IEditController::getState wrote.

use base64::Engine;

const TABLE: &[u8; 64] = b".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+";
const MAGIC: &[u8; 4] = b"VC2!";

pub fn juce_b64_decode(s: &str) -> Result<Vec<u8>, String> {
    let (size, data) = s.split_once('.').ok_or("JUCE base64: no '.'")?;
    let size: usize = size.trim().parse().map_err(|e| format!("JUCE base64 size: {e}"))?;
    let mut out = vec![0u8; size];
    for (i, ch) in data.bytes().enumerate() {
        let v = TABLE.iter().position(|c| *c == ch).ok_or_else(|| format!("JUCE base64: bad char {ch}"))? as u32;
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
    let n = (b.len() * 8 + 5) / 6;
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

#[allow(dead_code)]
pub struct WaveLinkState {
    pub xml: String,
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
pub fn decode_parameter_state(b64: &str) -> Result<WaveLinkState, String> {
    let raw = base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|e| format!("base64: {e}"))?;
    if raw.len() < 9 || &raw[..4] != MAGIC {
        return Err(format!("not a JUCE 'VC2!' XML blob (head {:02X?})", &raw[..raw.len().min(8)]));
    }
    let n = u32::from_le_bytes(raw[4..8].try_into().unwrap()) as usize;
    if 8 + n > raw.len() {
        return Err("VC2! length field exceeds blob".into());
    }
    let xml = String::from_utf8(raw[8..8 + n].to_vec()).map_err(|e| format!("xml utf8: {e}"))?;
    let component = tag_text(&xml, "IComponent").map(juce_b64_decode).transpose()?;
    let controller = tag_text(&xml, "IEditController").map(juce_b64_decode).transpose()?;
    Ok(WaveLinkState { xml, component, controller })
}

/// Build the base64 `ParameterState` exactly as Wave Link (JUCE VST3PluginInstance::getStateInformation) does.
pub fn encode_parameter_state(component: Option<&[u8]>, controller: Option<&[u8]>) -> String {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?> <VST3PluginState>");
    if let Some(c) = component {
        xml.push_str(&format!("<IComponent>{}</IComponent>", juce_b64_encode(c)));
    }
    if let Some(c) = controller {
        xml.push_str(&format!("<IEditController>{}</IEditController>", juce_b64_encode(c)));
    }
    xml.push_str("</VST3PluginState>");
    let mut raw = Vec::with_capacity(xml.len() + 9);
    raw.extend_from_slice(MAGIC);
    raw.extend_from_slice(&(xml.len() as u32).to_le_bytes());
    raw.extend_from_slice(xml.as_bytes());
    raw.push(0);
    base64::engine::general_purpose::STANDARD.encode(raw)
}

/// Readable view of a JUCE plugin's IComponent state: the plugin's own 'VC2!' XML plus the trailer the JUCE
/// VST3 wrapper appends ("JUCEPrivateData").
pub fn describe_component_state(b: &[u8]) -> String {
    if b.len() >= 8 && &b[..4] == MAGIC {
        let n = u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize;
        let end = (8 + n).min(b.len());
        let xml = String::from_utf8_lossy(&b[8..end]);
        let trailer = &b[end..];
        let has_private = trailer.windows(15).any(|w| w == b"JUCEPrivateData");
        format!("plugin XML ({n} chars): {xml}\n      trailer: {} bytes, JUCEPrivateData={has_private}", trailer.len())
    } else {
        format!("{} bytes, head {:02X?}", b.len(), &b[..b.len().min(16)])
    }
}

pub fn first_diff(a: &[u8], b: &[u8]) -> Option<usize> {
    (0..a.len().max(b.len())).find(|&i| a.get(i) != b.get(i))
}
