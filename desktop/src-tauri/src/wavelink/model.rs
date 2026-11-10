// Read-only view of Wave Link Settings.json: the inputs (mic first, same rule as src/wavelink/codec.ts
// parseSettings) and each input's effect chain in Wave Link order.
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::error::{err, WlErrorCode, WlResult};
use super::scan::{self, Node};

/// One effect of an input's chain (`AudioPluginConfigurations[index]`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainEntry {
    pub index: usize,
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub file_path: String,
    pub plugin_id: String,
    /// Wave Link `BypassState` (true = the effect is switched off).
    pub bypassed: bool,
    /// Base64 `ParameterState`, exactly as decoded from the file ('' for Wave Link's built-in effects).
    pub parameter_state: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WlInput {
    pub key: String,
    /// `InputName` when present, else the key.
    pub label: String,
    pub entries: Vec<ChainEntry>,
}

/// What `wavelink_read` returns: the file, its hash (pass it back to export) and the inputs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WlSnapshot {
    pub path: String,
    pub hash: String,
    pub inputs: Vec<WlInput>,
}

/// SHA-256 of the file bytes, lowercase hex.
pub fn hash_text(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// `MixerConfiguration.InputSettings` of the tree, or a Parse error when the file is not a Wave Link settings file.
pub(crate) fn input_settings(root: &Node) -> WlResult<&Node> {
    match root
        .get("MixerConfiguration")
        .and_then(|m| m.get("InputSettings"))
    {
        Some(n) if n.entries().is_some() => Ok(n),
        _ => err(
            WlErrorCode::Parse,
            "not a Wave Link settings file: no MixerConfiguration.InputSettings",
        ),
    }
}

/// [key, input node, chain items] of every input with an `AudioPluginConfigurations` list, file order.
/// A repeated input key keeps only its last occurrence (what serde_json and the TS codec read).
pub(crate) fn input_nodes(root: &Node) -> WlResult<Vec<(&str, &Node, &[Node])>> {
    let entries = input_settings(root)?.entries().unwrap_or_default();
    let last = |k: usize, key: &str| !entries[k + 1..].iter().any(|(other, _)| other == key);
    Ok(entries
        .iter()
        .enumerate()
        .filter(|(k, (key, _))| last(*k, key))
        .filter_map(|(_, (key, node))| {
            node.get("AudioPluginConfigurations")
                .and_then(Node::items)
                .map(|items| (key.as_str(), node, items))
        })
        .collect())
}

fn entry_of(text: &str, node: &Node, index: usize) -> ChainEntry {
    let s = |k: &str| node.get(k).and_then(|v| v.as_str(text)).unwrap_or_default();
    ChainEntry {
        index,
        id: s("Id"),
        name: s("Name"),
        vendor: s("Vendor"),
        file_path: s("FilePath"),
        plugin_id: s("PluginId"),
        bypassed: node
            .get("BypassState")
            .and_then(Node::as_bool)
            .unwrap_or(false),
        parameter_state: s("ParameterState"),
    }
}

fn norm(s: &str) -> String {
    s.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// ReaGate / ReaComp / ReaEQ by name (cockosKind in src/wavelink/plugins.ts; ReaFIR does not count).
fn is_decodable_reaplug(name: &str) -> bool {
    let n = norm(name);
    ["reagate", "reacomp", "reaeq"]
        .iter()
        .any(|w| n.starts_with(w))
}

/// Inputs with at least one effect plus empty PCM_IN (mic) inputs. The likely mic comes first: PCM_IN with
/// ReaPlugs, then any input with ReaPlugs, then PCM_IN, then the rest, each in file order.
pub fn list_inputs(text: &str) -> WlResult<Vec<WlInput>> {
    let mut inputs: Vec<WlInput> = all_chains(text)?
        .into_iter()
        .filter(|inp| !inp.entries.is_empty() || inp.key.contains("PCM_IN"))
        .collect();
    let rank = |inp: &WlInput| {
        let rea = inp.entries.iter().any(|e| is_decodable_reaplug(&e.name));
        (if rea { 0 } else { 2 }) + usize::from(!inp.key.contains("PCM_IN"))
    };
    inputs.sort_by_key(rank); // stable: file order within a rank
    Ok(inputs)
}

/// Every input with an effects list (no filtering, file order), for diff and verification.
pub(crate) fn all_chains(text: &str) -> WlResult<Vec<WlInput>> {
    let root = scan::parse(text)?;
    Ok(input_nodes(&root)?
        .into_iter()
        .map(|(key, node, items)| WlInput {
            key: key.to_string(),
            label: node
                .get("InputName")
                .and_then(|n| n.as_str(text))
                .filter(|l| !l.is_empty())
                .unwrap_or_else(|| key.to_string()),
            entries: items
                .iter()
                .enumerate()
                .map(|(k, n)| entry_of(text, n, k))
                .collect(),
        })
        .collect())
}
