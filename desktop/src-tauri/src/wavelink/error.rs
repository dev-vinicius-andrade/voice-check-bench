// Typed errors of the Wave Link module. Serialized to the UI as `{ code, message }` with stable codes.
use std::fmt;

use serde::Serialize;

/// Stable error codes (camelCase on the wire). The UI maps them to its own text; `message` is detail for logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WlErrorCode {
    /// Settings.json (or a backup) is missing or cannot be read.
    NotFound,
    /// Not valid JSON, not UTF-8, or not a Wave Link settings file.
    Parse,
    /// The file on disk no longer matches what the UI saw.
    ChangedMeanwhile,
    /// A change targets an input/effect/field that does not exist or is ambiguous (duplicate keys).
    MissingEntry,
    /// A change is malformed: not base64, nothing to change, two changes for the same field, bad backup path.
    InvalidChange,
    /// Wave Link did not close in time (and force was not allowed, or the forced close failed too).
    CloseTimeout,
    /// The backup or the new Settings.json could not be written.
    WriteFailed,
    /// Wave Link could not be started again.
    StartFailed,
    /// After writing, the file does not hold the requested values.
    VerifyFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WlError {
    pub code: WlErrorCode,
    pub message: String,
}

impl WlError {
    pub fn new(code: WlErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for WlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for WlError {}

pub type WlResult<T> = Result<T, WlError>;

/// Shorthand constructor: `err(WlErrorCode::Parse, "…")`.
pub fn err<T>(code: WlErrorCode, message: impl Into<String>) -> WlResult<T> {
    Err(WlError::new(code, message))
}
