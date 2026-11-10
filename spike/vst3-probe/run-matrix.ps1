# Offline processing matrix for one plugin: each combination runs in its own process.
# Usage: run-matrix.ps1 -Plugin ElgatoNoiseRemoval -Wav <mono 48k wav> [-Extra '--param','773352680=0']
param(
  [string]$Plugin = 'ElgatoNoiseRemoval',
  [Parameter(Mandatory = $true)][string]$Wav,
  [string[]]$Extra = @(),
  [string[][]]$Combos = @(
    @('--block', '480'),
    @('--block', '480', '--stereo'),
    @('--block', '480', '--realtime'),
    @('--block', '480', '--stereo', '--realtime', '--context'),
    @('--block', '512', '--realtime', '--context'),
    @('--block', '480', '--host-name', 'Elgato Wave Link'),
    @('--block', '480', '--stereo', '--realtime', '--context', '--host-name', 'Elgato Wave Link')
  )
)
$root = $PSScriptRoot
$exe = Join-Path $root 'target\release\vst3-probe.exe'
$settings = Join-Path $root 'out\Settings.copy.json'
$vst = "C:\Program Files\Common Files\VST3\Elgato\$Plugin.vst3"
$i = 0
foreach ($c in $Combos) {
  $i++
  $quoted = $c | ForEach-Object { if ($_ -match ' ') { "`"$_`"" } else { $_ } }
  $extraQ = $Extra | ForEach-Object { if ($_ -match ' ') { "`"$_`"" } else { $_ } }
  $out = Join-Path $root "out\$Plugin.matrix$i.wav"
  $log = Join-Path $root "out\$Plugin.matrix$i.log"
  $argList = @("`"$vst`"", '--settings', "`"$settings`"", '--in', "`"$Wav`"", '--out', "`"$out`"") + $quoted + $extraQ
  $proc = Start-Process -FilePath $exe -ArgumentList $argList -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.stderr"
  "[$i] exit $($proc.ExitCode)  args: $($c -join ' ') $($Extra -join ' ')"
  Get-Content $log | Select-String -Pattern 'setBusArrangements|getLatency|processing:|overall:|p10:|noise floor|per-frame|identical|^STEP4|FAIL' | ForEach-Object { '    ' + $_.Line.Trim() }
}
