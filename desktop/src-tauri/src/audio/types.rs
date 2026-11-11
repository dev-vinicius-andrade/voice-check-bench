// Serializable views of the engine for the UI (serde camelCase; mirrored in src/desktop/types.ts).
use serde::Serialize;

use super::devices::AudioDevice;
use super::pipeline::Monitor;
use super::stats::CountersSnapshot;
use crate::chain::SlotInfo;
use crate::host::ParamInfo;

/// The Wave Link input whose chain the engine runs (read-only from Settings.json).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainSource {
    pub settings_path: String,
    pub input_key: String,
    pub input_label: String,
}

/// A chain slot with its current parameters.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSlot {
    #[serde(flatten)]
    pub info: SlotInfo,
    pub params: Vec<ParamInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyInfo {
    /// Constant chain latency: raw is delayed by this to line up with processed (bypassed slots included).
    pub aligned_samples: u32,
    /// What the slots processing right now add; the rest is compensation.
    pub active_samples: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub source: Option<ChainSource>,
    pub input: AudioDevice,
    pub output: AudioDevice,
    pub sample_rate: u32,
    pub block_size: u32,
    pub monitor: Monitor,
    pub gain_db: f32,
    pub latency: LatencyInfo,
    pub settled: bool,
    pub slots: Vec<AudioSlot>,
    pub counters: CountersSnapshot,
    /// Last error reported by a WASAPI stream (device unplugged, …).
    pub last_stream_error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chain::SlotStatus;
    use crate::host::PluginKind;

    #[test]
    fn slot_serializes_flat_with_params() {
        let slot = AudioSlot {
            info: SlotInfo {
                index: 9,
                name: "Elgato Noise Removal".into(),
                file_path: "C:\nr.vst3".into(),
                status: SlotStatus::Hosted {
                    kind: PluginKind::Vst3,
                    plugin_id: "f4a9d925".into(),
                    has_own_bypass: true,
                },
                bypassed: false,
                latency_samples: 0,
                full_latency_samples: 480,
            },
            params: vec![ParamInfo {
                id: 1,
                name: "Bypass".into(),
                display: "On".into(),
                normalized: 1.0,
                is_bypass: true,
            }],
        };
        assert_eq!(
            serde_json::to_value(&slot).unwrap(),
            serde_json::json!({
                "index": 9, "name": "Elgato Noise Removal", "filePath": "C:\nr.vst3",
                "status": {"status": "hosted", "kind": "vst3", "pluginId": "f4a9d925", "hasOwnBypass": true},
                "bypassed": false, "latencySamples": 0, "fullLatencySamples": 480,
                "params": [{"id": 1, "name": "Bypass", "display": "On", "normalized": 1.0, "isBypass": true}]
            })
        );
    }

    #[test]
    fn monitor_wire_names() {
        for (m, s) in [
            (Monitor::Processed, "processed"),
            (Monitor::Raw, "raw"),
            (Monitor::Off, "off"),
        ] {
            assert_eq!(serde_json::to_value(m).unwrap(), serde_json::json!(s));
            assert_eq!(
                serde_json::from_value::<Monitor>(serde_json::json!(s)).unwrap(),
                m
            );
        }
        let latency = serde_json::to_value(LatencyInfo {
            aligned_samples: 4576,
            active_samples: 4096,
        })
        .unwrap();
        assert_eq!(
            latency,
            serde_json::json!({"alignedSamples": 4576, "activeSamples": 4096})
        );
    }
}
