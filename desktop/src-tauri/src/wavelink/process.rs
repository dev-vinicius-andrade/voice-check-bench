// Controlling the Wave Link process: is it running, close it politely or by force, start it again. The export flow
// only talks to the `ProcessControl` trait, so tests use a fake and never touch the real app.
use std::process::{Command, Output};
use std::time::Duration;

use super::error::{err, WlErrorCode, WlResult};

/// Package family of the Microsoft Store Wave Link (Settings.json lives under this package's LocalState).
pub const PACKAGE_FAMILY: &str = "Elgato.WaveLink_g54w8ztgkx496";
/// AUMID used when the Start menu lookup fails (`Get-StartApps` shows this for Wave Link 3.x).
pub const DEFAULT_AUMID: &str = "Elgato.WaveLink_g54w8ztgkx496!App";
/// Image name of the packaged Wave Link process.
pub const IMAGE_NAME: &str = "Elgato.WaveLink.exe";

pub trait ProcessControl {
    fn is_running(&self) -> WlResult<bool>;
    /// Asks Wave Link to close (WM_CLOSE to its windows); returns without waiting.
    fn request_close(&self) -> WlResult<()>;
    /// Terminates Wave Link.
    fn force_close(&self) -> WlResult<()>;
    /// Launches Wave Link; returns without waiting.
    fn start(&self) -> WlResult<()>;
    /// Waits; injectable so tests run instantly.
    fn sleep(&self, d: Duration) {
        std::thread::sleep(d);
    }
}

/// The real Wave Link on this PC, driven through `tasklist`, `taskkill` and `explorer.exe shell:AppsFolder\<AUMID>`.
pub struct WaveLinkProcess;

#[cfg(windows)]
fn run(program: &str, args: &[&str]) -> std::io::Result<Output> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
}

#[cfg(not(windows))]
fn run(program: &str, args: &[&str]) -> std::io::Result<Output> {
    Command::new(program).args(args).output()
}

/// PIDs from `tasklist /FO CSV /NH` output ("image","pid",…); the "No tasks" info line has no quotes.
pub fn parse_tasklist(stdout: &str) -> Vec<u32> {
    stdout
        .lines()
        .filter_map(|l| {
            let mut cols = l.split("\",\"");
            let image = cols.next()?.trim_start_matches('"');
            (image.eq_ignore_ascii_case(IMAGE_NAME))
                .then(|| cols.next()?.parse().ok())
                .flatten()
        })
        .collect()
}

impl WaveLinkProcess {
    fn pids(&self) -> WlResult<Vec<u32>> {
        let filter = format!("IMAGENAME eq {IMAGE_NAME}");
        match run("tasklist", &["/FI", &filter, "/FO", "CSV", "/NH"]) {
            Ok(out) => Ok(parse_tasklist(&String::from_utf8_lossy(&out.stdout))),
            Err(e) => err(
                WlErrorCode::CloseTimeout,
                format!("cannot list processes: {e}"),
            ),
        }
    }

    fn taskkill(&self, force: bool) -> WlResult<()> {
        for pid in self.pids()? {
            let pid = pid.to_string();
            let mut args = vec!["/PID", pid.as_str()];
            if force {
                args.push("/F");
            }
            // A failure here shows up as "still running" in the caller's wait loop.
            let _ = run("taskkill", &args);
        }
        Ok(())
    }

    /// Wave Link's AUMID from the Start menu apps list, else `DEFAULT_AUMID`. Read-only.
    pub fn aumid() -> String {
        let script = format!("(Get-StartApps | Where-Object {{ $_.AppID -like '{PACKAGE_FAMILY}!*' }} | Select-Object -First 1).AppID");
        run(
            "powershell.exe",
            &["-NoProfile", "-NonInteractive", "-Command", &script],
        )
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|id| id.starts_with(PACKAGE_FAMILY) && id.contains('!'))
        .unwrap_or_else(|| DEFAULT_AUMID.to_string())
    }
}

impl ProcessControl for WaveLinkProcess {
    fn is_running(&self) -> WlResult<bool> {
        Ok(!self.pids()?.is_empty())
    }

    fn request_close(&self) -> WlResult<()> {
        self.taskkill(false)
    }

    fn force_close(&self) -> WlResult<()> {
        self.taskkill(true)
    }

    fn start(&self) -> WlResult<()> {
        let target = format!("shell:AppsFolder\\{}", Self::aumid());
        // explorer.exe often exits with 1 even on success; the caller checks that Wave Link is running instead.
        match run("explorer.exe", &[&target]) {
            Ok(_) => Ok(()),
            Err(e) => err(
                WlErrorCode::StartFailed,
                format!("cannot launch Wave Link: {e}"),
            ),
        }
    }
}
