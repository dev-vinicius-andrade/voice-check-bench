// Wave Link Settings.json: read the inputs and their effect chains, surgical edits with a diff, and the
// export / restore flow (backup → close Wave Link → atomic write → start → verify). SPEC "Desktop app (v2.0)".
pub mod commands;
pub mod edit;
pub mod error;
pub mod export;
pub mod files;
pub mod model;
pub mod process;
pub mod scan;

pub use edit::{apply, diff, ChainChange, DiffField, DiffLine};
pub use error::{WlError, WlErrorCode, WlResult};
pub use export::{export, restore, FlowReport, Options, Step, Timings};
pub use files::{default_settings_path, list_backups, BackupInfo};
pub use model::{hash_text, list_inputs, ChainEntry, WlInput, WlSnapshot};
pub use process::{ProcessControl, WaveLinkProcess};

#[cfg(test)]
mod flow_tests;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
