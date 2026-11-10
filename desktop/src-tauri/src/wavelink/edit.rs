// Surgical edits of Settings.json: replace single ParameterState / BypassState values in place, every other byte
// unchanged (formatting, key order, escaping). Plus a field-level diff of two texts for the confirmation dialog.
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::error::{err, WlErrorCode, WlResult};
use super::model::{all_chains, input_settings, WlInput};
use super::scan::{self, Kind, Node};

/// One change to an effect of an input's chain. At least one of the two fields is set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainChange {
    pub input_key: String,
    /// Index in `AudioPluginConfigurations`.
    pub index: usize,
    /// New base64 `ParameterState`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameter_state: Option<String>,
    /// New `BypassState` (true = effect off).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bypassed: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffField {
    ParameterState,
    Bypass,
    /// The number of effects of an input differs.
    Chain,
}

/// One changed field. `from`/`to` are short plain values ("on"/"off", "changed (N bytes)"); the byte counts let
/// the UI word ParameterState changes itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub input_key: String,
    pub input: String,
    pub index: usize,
    pub plugin: String,
    pub field: DiffField,
    pub from: String,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_bytes: Option<usize>,
}

/// True when the file escapes like .NET System.Text.Json (Wave Link writes '+' as + and '"' as ").
pub fn is_dotnet_style(text: &str) -> bool {
    text.contains("\\u002B") || text.contains("\\u0022")
}

/// A JSON string literal the way .NET System.Text.Json writes it by default (port of dotnetString in
/// src/wavelink/json.ts): " ' + < > & ` and everything outside printable ASCII as \uXXXX per UTF-16 unit.
pub fn dotnet_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' | '\'' | '+' | '<' | '>' | '&' | '`' => {
                out.push_str(&format!("\\u{:04X}", c as u32))
            }
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (' '..'\u{7f}').contains(&c) => out.push(c),
            c => {
                let mut units = [0u16; 2];
                for u in c.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{:04X}", u));
                }
            }
        }
    }
    out.push('"');
    out
}

/// A string literal in the escaping style of `text`.
pub fn encode_like(text: &str, value: &str) -> String {
    if is_dotnet_style(text) {
        dotnet_string(value)
    } else {
        serde_json::to_string(value).unwrap_or_default()
    }
}

/// Byte length of a standard base64 string, None when it is not valid padded base64.
pub fn base64_len(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    if !b.len().is_multiple_of(4) {
        return None;
    }
    let pad = b.iter().rev().take_while(|&&c| c == b'=').count();
    let body_ok = b[..b.len() - pad]
        .iter()
        .all(|c| c.is_ascii_alphanumeric() || *c == b'+' || *c == b'/');
    (pad <= 2 && body_ok).then(|| b.len() / 4 * 3 - pad)
}

fn missing<T>(c: &ChainChange, what: &str) -> WlResult<T> {
    err(
        WlErrorCode::MissingEntry,
        format!("input {} effect {}: {what}", c.input_key, c.index),
    )
}

/// The single value of `key` in `node`; missing or repeated keys are refused.
fn single<'a>(node: &'a Node, key: &str, c: &ChainChange) -> WlResult<&'a Node> {
    match node.get_all(key).as_slice() {
        [one] => Ok(one),
        [] => missing(c, &format!("{key} not found")),
        _ => missing(c, &format!("{key} appears more than once (ambiguous)")),
    }
}

/// The chain entry node a change targets.
fn target<'a>(root: &'a Node, c: &ChainChange) -> WlResult<&'a Node> {
    let input = single(input_settings(root)?, &c.input_key, c)?;
    let list = single(input, "AudioPluginConfigurations", c)?;
    let Some(items) = list.items() else {
        return missing(c, "AudioPluginConfigurations is not a list");
    };
    match items.get(c.index) {
        Some(n) if n.entries().is_some() => Ok(n),
        Some(_) => missing(c, "entry is not an object"),
        None => missing(
            c,
            &format!("no entry at this index (the chain has {})", items.len()),
        ),
    }
}

/// New text with the changes applied. Only the targeted string/bool literals change; a change to the value already
/// in the file is a no-op, so the text stays byte-identical. Refuses missing or ambiguous targets, non-base64 or empty
/// states, changes with no field, and two changes for the same field.
pub fn apply(text: &str, changes: &[ChainChange]) -> WlResult<String> {
    let root = scan::parse(text)?;
    let mut seen = HashSet::new();
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    for c in changes {
        if c.parameter_state.is_none() && c.bypassed.is_none() {
            return err(
                WlErrorCode::InvalidChange,
                format!(
                    "input {} effect {}: nothing to change",
                    c.input_key, c.index
                ),
            );
        }
        let entry = target(&root, c)?;
        if let Some(state) = &c.parameter_state {
            if !seen.insert((c.input_key.as_str(), c.index, "ParameterState")) {
                return err(
                    WlErrorCode::InvalidChange,
                    format!(
                        "input {} effect {}: ParameterState changed twice",
                        c.input_key, c.index
                    ),
                );
            }
            if state.is_empty() || base64_len(state).is_none() {
                return err(
                    WlErrorCode::InvalidChange,
                    format!(
                        "input {} effect {}: new ParameterState is not base64",
                        c.input_key, c.index
                    ),
                );
            }
            let node = single(entry, "ParameterState", c)?;
            let Some(old) = node.as_str(text) else {
                return missing(c, "ParameterState is not a string");
            };
            if &old != state {
                edits.push((node.start, node.end, encode_like(text, state)));
            }
        }
        if let Some(bypassed) = c.bypassed {
            if !seen.insert((c.input_key.as_str(), c.index, "BypassState")) {
                return err(
                    WlErrorCode::InvalidChange,
                    format!(
                        "input {} effect {}: BypassState changed twice",
                        c.input_key, c.index
                    ),
                );
            }
            let node = single(entry, "BypassState", c)?;
            let Kind::Bool(old) = node.kind else {
                return missing(c, "BypassState is not true/false");
            };
            if old != bypassed {
                edits.push((node.start, node.end, bypassed.to_string()));
            }
        }
    }
    edits.sort_by_key(|e| std::cmp::Reverse(e.0));
    let mut out = text.to_string();
    for (start, end, value) in edits {
        out.replace_range(start..end, &value);
    }
    Ok(out)
}

const fn on_off(bypassed: bool) -> &'static str {
    if bypassed {
        "off"
    } else {
        "on"
    }
}

fn input_diff(old: &WlInput, new: &WlInput, out: &mut Vec<DiffLine>) {
    let line = |index: usize, plugin: &str, field, from: String, to: String| DiffLine {
        input_key: new.key.clone(),
        input: new.label.clone(),
        index,
        plugin: plugin.to_string(),
        field,
        from,
        to,
        from_bytes: None,
        to_bytes: None,
    };
    for (a, b) in old.entries.iter().zip(&new.entries) {
        if a.parameter_state != b.parameter_state {
            let (fb, tb) = (
                base64_len(&a.parameter_state),
                base64_len(&b.parameter_state),
            );
            let to = format!("changed ({} bytes)", tb.unwrap_or(b.parameter_state.len()));
            let from = format!("{} bytes", fb.unwrap_or(a.parameter_state.len()));
            out.push(DiffLine {
                from_bytes: fb,
                to_bytes: tb,
                ..line(b.index, &b.name, DiffField::ParameterState, from, to)
            });
        }
        if a.bypassed != b.bypassed {
            out.push(line(
                b.index,
                &b.name,
                DiffField::Bypass,
                on_off(a.bypassed).into(),
                on_off(b.bypassed).into(),
            ));
        }
    }
    if old.entries.len() != new.entries.len() {
        let (from, to) = (
            format!("{} effects", old.entries.len()),
            format!("{} effects", new.entries.len()),
        );
        out.push(line(0, "", DiffField::Chain, from, to));
    }
}

/// Field-level differences between two Settings.json texts, per input present in both (file order).
pub fn diff(old: &str, new: &str) -> WlResult<Vec<DiffLine>> {
    let (before, after) = (all_chains(old)?, all_chains(new)?);
    let mut out = Vec::new();
    for b in &after {
        if let Some(a) = before.iter().find(|a| a.key == b.key) {
            input_diff(a, b, &mut out);
        }
    }
    Ok(out)
}
