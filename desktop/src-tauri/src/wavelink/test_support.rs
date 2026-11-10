// Test-only helpers: a small Settings.json in Wave Link's own format (.NET escaping, CRLF, 2-space indent),
// temp folders that clean up after themselves, and the path of the real file when this PC has Wave Link.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

pub const MIC: &str = "DS52\\\\PCM_IN_01_C_00_SD1";
/// Base64 states with '+' so the \u002B escaping is exercised. GATE_STATE is also used by the Game input's ReaComp.
pub const GATE_STATE: &str = "Q2NuSwAA+/8=";
pub const NEW_STATE: &str = "Q2NuSwAB+++/";

const LINES: &[&str] = &[
    "{",
    r#"  "General": {"#,
    r#"    "Note": "a \u0022quoted\u0022 \u002B plus \u003Ctag\u003E","#,
    r#"    "Count": 1.50"#,
    "  },",
    r#"  "MixerConfiguration": {"#,
    r#"    "InputSettings": {"#,
    r#"      "PCM_OUT_00_V_12_SD7": {"#,
    r#"        "InputName": "System","#,
    r#"        "AudioPluginConfigurations": []"#,
    "      },",
    r#"      "DS52\\\\PCM_IN_01_C_00_SD1": {"#,
    r#"        "InputName": "2- Elgato Wave:XLR","#,
    r#"        "AudioPluginConfigurations": ["#,
    "          {",
    r#"            "Id": "58c4ebed","#,
    r#"            "Name": "ReaGate (ReaPlugs Edition)","#,
    r#"            "PluginId": "72656774","#,
    r#"            "Category": "Effect","#,
    r#"            "Vendor": "Cockos","#,
    r#"            "FilePath": "C:\\Program Files\\Common Files\\VST2\\reagate-standalone.dll","#,
    r#"            "ParameterState": "Q2NuSwAA\u002B/8=","#,
    r#"            "BypassState": false,"#,
    r#"            "CustomName": null"#,
    "          },",
    "          {",
    r#"            "Id": "8d7fd327","#,
    r#"            "Name": "Elgato De-Esser","#,
    r#"            "PluginId": "f3a0e81a","#,
    r#"            "Category": "Fx","#,
    r#"            "Vendor": "Elgato","#,
    r#"            "FilePath": "C:\\Program Files\\Common Files\\VST3\\Elgato\\ElgatoDeEsser.vst3","#,
    r#"            "ParameterState": "VkMyIW4E","#,
    r#"            "BypassState": true,"#,
    r#"            "CustomName": null"#,
    "          },",
    "          {",
    r#"            "Id": "PCM_OUT_00_V_16_SD9_WaveEQ","#,
    r#"            "Name": "WaveEQ","#,
    r#"            "PluginId": "PCM_OUT_00_V_16_SD9_WaveEQ","#,
    r#"            "Category": "Fx","#,
    r#"            "Vendor": "Elgato","#,
    r#"            "FilePath": "","#,
    r#"            "ParameterState": "","#,
    r#"            "BypassState": false,"#,
    r#"            "CustomName": null"#,
    "          }",
    "        ]",
    "      },",
    r#"      "PCM_OUT_00_V_06_SD4": {"#,
    r#"        "InputName": "Game","#,
    r#"        "AudioPluginConfigurations": ["#,
    "          {",
    r#"            "Name": "ReaComp (ReaPlugs Edition)","#,
    r#"            "Vendor": "Cockos","#,
    r#"            "ParameterState": "Q2NuSwAA\u002B/8=","#,
    r#"            "BypassState": false"#,
    "          }",
    "        ]",
    "      }",
    "    }",
    "  }",
    "}",
];

/// The synthesized Settings.json text (CRLF, final newline).
pub fn fixture() -> String {
    LINES.join("\r\n") + "\r\n"
}

/// A fresh empty folder under the system temp dir, removed on drop.
pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new(tag: &str) -> Self {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("vcb-wavelink-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        Self(dir)
    }

    /// Writes `text` as `Settings.json` in this folder and returns its path.
    pub fn settings(&self, text: &str) -> PathBuf {
        let p = self.0.join("Settings.json");
        std::fs::write(&p, text).expect("write fixture");
        p
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The real Wave Link Settings.json when it exists on this PC (never written by tests: they copy it).
pub fn real_settings() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let p = PathBuf::from(base)
        .join("Packages")
        .join(super::process::PACKAGE_FAMILY)
        .join("LocalState")
        .join("Settings.json");
    p.is_file().then_some(p)
}
