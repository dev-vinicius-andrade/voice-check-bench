// Read-only view of a Wave Link Settings.json COPY: the plugin entries of the mic input, and a text-level
// ParameterState replacement that keeps every other byte of the file identical (.NET escapes '+' as +).
use std::path::Path;

use anyhow::{Context, Result, bail};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub file_path: String,
    pub parameter_state: String,
    pub bypass: bool,
}

impl Entry {
    pub fn is_reaplug(&self) -> bool {
        self.vendor == "Cockos" && self.file_path.to_ascii_lowercase().ends_with(".dll")
    }
    pub fn blob(&self) -> Result<Vec<u8>> {
        Ok(STANDARD.decode(&self.parameter_state)?)
    }
    /// "ReaGate (ReaPlugs Edition)" -> "ReaGate"
    pub fn short(&self) -> &str {
        self.name.split(' ').next().unwrap_or(&self.name)
    }
}

pub struct SettingsCopy {
    pub raw: String,
    pub input_key: String,
    pub entries: Vec<Entry>,
}

pub fn load(path: &Path) -> Result<SettingsCopy> {
    let raw = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let v: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))?;
    let inputs = v["MixerConfiguration"]["InputSettings"].as_object().context("no MixerConfiguration.InputSettings")?;
    let (key, inp) = inputs
        .iter()
        .find(|(k, i)| {
            k.contains("PCM_IN")
                && i["AudioPluginConfigurations"].as_array().is_some_and(|a| a.iter().any(|p| p["Vendor"] == "Cockos"))
        })
        .context("no PCM_IN input with ReaPlugs")?;
    let s = |p: &Value, k: &str| p[k].as_str().unwrap_or("").to_string();
    let entries = inp["AudioPluginConfigurations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| Entry {
            id: s(p, "Id"),
            name: s(p, "Name"),
            vendor: s(p, "Vendor"),
            file_path: s(p, "FilePath"),
            parameter_state: s(p, "ParameterState"),
            bypass: p["BypassState"].as_bool().unwrap_or(false),
        })
        .collect();
    Ok(SettingsCopy { raw, input_key: key.clone(), entries })
}

fn dotnet_escape(b64: &str) -> String {
    b64.replace('+', "\\u002B")
}

/// New file text with one plugin's ParameterState replaced; every other byte is unchanged.
pub fn replace_state(raw: &str, old_b64: &str, new_bytes: &[u8]) -> Result<String> {
    let old = format!("\"{}\"", dotnet_escape(old_b64));
    let new = format!("\"{}\"", dotnet_escape(&STANDARD.encode(new_bytes)));
    let hits = raw.matches(&old).count();
    if hits != 1 {
        bail!("expected exactly one occurrence of the old ParameterState, found {hits}");
    }
    Ok(raw.replacen(&old, &new, 1))
}
