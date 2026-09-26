param([switch]$SkipNative)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$logRoot = Join-Path $PWD ('.validation/checks/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
function Checked([string]$Name,[string]$Tool,[string[]]$Arguments) {
  # Windows PowerShell wraps native stderr as ErrorRecord even on success.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Tool @Arguments 2>&1 | ForEach-Object { $_.ToString() } | Tee-Object -FilePath (Join-Path $logRoot "$Name.log")
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if($code -ne 0){throw "$Name failed ($code)"}
}
# Reinstall exactly from the lockfile; no dependency on previous .validation tools.
Checked 'dependencies' 'npm.cmd' @('ci')
Checked 'frontend-build' 'npm.cmd' @('run','build')
Checked 'frontend-tests' 'npm.cmd' @('test')
Checked 'lint' 'npm.cmd' @('run','lint')
Checked 'format' 'npm.cmd' @('run','format:check')
Checked 'rust-tests' 'cargo.exe' @('test','--manifest-path','src-tauri/Cargo.toml','--locked')
Checked 'rust-format' 'cargo.exe' @('fmt','--manifest-path','src-tauri/Cargo.toml','--check')
Checked 'clippy' 'cargo.exe' @('clippy','--manifest-path','src-tauri/Cargo.toml','--locked','--all-targets','--','-D','warnings')
if(!$SkipNative){Checked 'native' 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File','tests/native/run.ps1')}
# Restore the normal production identity after building the isolated acceptance app.
Checked 'production-bundle' 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/build-release.ps1')
# Use .NET directly: Get-FileHash may be unavailable in inherited PowerShell module paths.
$artifactHashes = foreach ($artifactPath in @('src-tauri/target/release/dinheirovisk.exe','src-tauri/target/release/bundle/nsis/Dinheirovisky_0.1.0_x64-setup.exe')) {
  $artifactStream = [IO.File]::OpenRead([IO.Path]::GetFullPath($artifactPath))
  $artifactHasher = [Security.Cryptography.SHA256]::Create()
  try {
    $artifactHash = [BitConverter]::ToString($artifactHasher.ComputeHash($artifactStream)).Replace('-','')
    "$artifactHash  $artifactPath"
  } finally { $artifactHasher.Dispose(); $artifactStream.Dispose() }
}
[IO.File]::WriteAllLines((Join-Path $logRoot 'hashes.txt'), [string[]]$artifactHashes)
Write-Output "Validation logs: $logRoot"
