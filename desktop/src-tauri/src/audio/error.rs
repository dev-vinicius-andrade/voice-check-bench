// Typed errors of the audio engine. Serialized to the UI as `{ code, message }` with stable codes (like wavelink/).
use std::fmt;

use serde::Serialize;

use crate::host::HostError;
use crate::wavelink::WlError;

/// Stable error codes (camelCase on the wire). The UI maps them to its own text; `message` is detail for logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioErrorCode {
    /// No engine is running (start it first).
    NotRunning,
    /// An engine is already running (stop it before starting another).
    AlreadyRunning,
    /// No input or output device at all.
    NoDevice,
    /// The requested device id does not exist (any more).
    DeviceNotFound,
    /// The device's sample format or rate cannot be used (the engine runs at 48 kHz).
    UnsupportedFormat,
    /// The WASAPI stream could not be built or started.
    StreamFailed,
    /// Wave Link Settings.json could not be read, or it has no input with effects.
    Settings,
    /// A plugin call failed (load, parameter, bypass, state).
    Chain,
    /// A command argument is out of range (gain, slot, …).
    InvalidArgument,
    /// The control queue to the audio thread is full (the audio thread has stalled).
    QueueFull,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AudioError {
    pub code: AudioErrorCode,
    pub message: String,
}

impl AudioError {
    pub fn new(code: AudioErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for AudioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for AudioError {}

impl From<HostError> for AudioError {
    fn from(e: HostError) -> Self {
        AudioError::new(AudioErrorCode::Chain, e.0)
    }
}

impl From<WlError> for AudioError {
    fn from(e: WlError) -> Self {
        AudioError::new(AudioErrorCode::Settings, e.to_string())
    }
}

pub type AudioResult<T> = Result<T, AudioError>;

/// Shorthand constructor: `err(AudioErrorCode::NotRunning, "…")`.
pub fn err<T>(code: AudioErrorCode, message: impl Into<String>) -> AudioResult<T> {
    Err(AudioError::new(code, message))
}
