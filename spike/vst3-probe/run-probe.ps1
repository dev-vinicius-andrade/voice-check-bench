# Runs vst3-probe on each Elgato VST3 effect in its own process (a crash only kills that run).
# Reads only the Settings.json COPY in out/. Writes logs to out/<plugin>.<host>.log.
param(
  [string]$HostName = 'VoiceCheckBench VST3 Probe',
  [string[]]$Plugins = @('ElgatoNoiseRemoval', 'ElgatoEq', 'ElgatoDeEsser', 'ElgatoCompressor')
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$exe = Join-Path $root 'target\release\vst3-probe.exe'
$settings = Join-Path $root 'out\Settings.copy.json'
$tag = ($HostName -replace '[^A-Za-z0-9]+', '-').Trim('-')
foreach ($p in $Plugins) {
  $vst = "C:\Program Files\Common Files\VST3\Elgato\$p.vst3"
  $log = Join-Path $root "out\$p.$tag.log"
  $err = Join-Path $root "out\$p.$tag.stderr.log"
  $argList = @("`"$vst`"", '--host-name', "`"$HostName`"", '--settings', "`"$settings`"", '--dump', "`"$(Join-Path $root 'out\dump')`"")
  $proc = Start-Process -FilePath $exe -ArgumentList $argList -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError $err
  '{0,-20} exit {1} (0x{1:X8})  log {2}' -f $p, $proc.ExitCode, $log
  Get-Content $log | Select-String -Pattern '^STEP|FAIL|BYTE COMPARE|rebuilt ParameterState|PluginId=' | ForEach-Object { '    ' + $_.Line.Trim() }
}
