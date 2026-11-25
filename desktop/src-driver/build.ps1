# VCB Virtual Audio Capture Driver — Build Script
# Run from an elevated Developer Command Prompt with WDK installed.
# Usage: .\build.ps1 [-Configuration Debug|Release] [-Sign]

param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",

    [switch]$Sign
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SolutionFile = Join-Path $ProjectDir "vcb_capture.vcxproj"

Write-Host "=== VCB Virtual Audio Capture Driver Build ===" -ForegroundColor Cyan
Write-Host "Configuration: $Configuration"
Write-Host "Project: $SolutionFile"

# Check for MSBuild (WDK)
$msbuild = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" `
    -latest -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe" 2>$null | Select-Object -First 1

if (-not $msbuild -or -not (Test-Path $msbuild)) {
    Write-Error "MSBuild not found. Install Visual Studio with C++ and WDK components."
    exit 1
}

Write-Host "Using MSBuild: $msbuild"

# Build the driver
& $msbuild $SolutionFile /p:Configuration=$Configuration /p:Platform=x64 /m /verbosity:minimal
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

$outputDir = Join-Path $ProjectDir "x64\$Configuration"
$sysFile = Join-Path $outputDir "vcb_capture.sys"
$infFile = Join-Path $outputDir "vcb_capture.inf"

if (-not (Test-Path $sysFile)) {
    Write-Error "Driver binary not found at $sysFile"
    exit 1
}

Write-Host "`nBuild successful!" -ForegroundColor Green
Write-Host "  Driver: $sysFile"
Write-Host "  INF:    $infFile"

# Optional: test-sign the driver
if ($Sign) {
    Write-Host "`n--- Test Signing ---" -ForegroundColor Yellow

    # Create self-signed test certificate if it doesn't exist
    $certName = "VCB Test Certificate"
    $cert = Get-ChildItem Cert:\LocalMachine\Root -Recurse |
        Where-Object { $_.Subject -match $certName } | Select-Object -First 1

    if (-not $cert) {
        Write-Host "Creating test signing certificate..."
        $cert = New-SelfSignedCertificate -Type CodeSigningCert `
            -Subject "CN=$certName" `
            -KeyAlgorithm RSA -KeyLength 2048 `
            -HashAlgorithm SHA256 `
            -CertStoreLocation Cert:\LocalMachine\My `
            -NotAfter (Get-Date).AddYears(5)

        # Move to Trusted Root CA store
        $store = [System.Security.Cryptography.X509Certificates.X509Store]::new("Root", "LocalMachine")
        $store.Open("ReadWrite")
        $store.Add($cert)
        $store.Close()
        Write-Host "Certificate created and added to Trusted Root CA store."
    } else {
        Write-Host "Using existing certificate: $($cert.Subject)"
    }

    # Sign the driver
    signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
        /sm /n "$certName" $sysFile

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Signing failed. Ensure TESTSIGNING is enabled: bcdedit /set TESTSIGNING ON"
    } else {
        Write-Host "Driver signed successfully." -ForegroundColor Green
    }
}

Write-Host "`n=== Installation Instructions ===" -ForegroundColor Cyan
Write-Host "1. Enable test signing (admin): bcdedit /set TESTSIGNING ON"
Write-Host "2. Reboot"
Write-Host "3. Install driver (admin): devcon install vcb_capture.inf Root\VCB_Capture"
Write-Host "4. Verify: 'Voice Check Bench Mic' appears in Windows Sound > Recording"
Write-Host "5. Start the Voice Check Bench desktop app to begin processing audio"