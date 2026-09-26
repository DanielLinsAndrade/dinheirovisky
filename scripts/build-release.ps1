param([string]$Config)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$previousLocation = Get-Location
$previousFlags = [Environment]::GetEnvironmentVariable('CARGO_ENCODED_RUSTFLAGS', 'Process')
if (!$previousFlags -and $env:RUSTFLAGS) {
  throw 'Use CARGO_ENCODED_RUSTFLAGS instead of RUSTFLAGS for a release with custom compiler flags.'
}
try {
  Set-Location -LiteralPath $repo
  # Unit separators preserve spaces in Windows paths without shell quoting.
  $flags = @()
  if ($previousFlags) { $flags += $previousFlags }
  if ($env:USERPROFILE) { $flags += "--remap-path-prefix=$env:USERPROFILE=/build/user" }
  $flags += "--remap-path-prefix=$repo=/build/dinheirovisky"
  $env:CARGO_ENCODED_RUSTFLAGS = $flags -join [char]31
  $arguments = @('node_modules/@tauri-apps/cli/tauri.js', 'build')
  if ($Config) { $arguments += @('--config', $Config) }
  & node.exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "Release build failed ($LASTEXITCODE)" }
  $bytes = [IO.File]::ReadAllBytes((Join-Path $repo 'src-tauri/target/release/dinheirovisk.exe'))
  $utf8 = [Text.Encoding]::UTF8.GetString($bytes)
  $utf16 = [Text.Encoding]::Unicode.GetString($bytes)
  foreach ($prefix in @($repo, $env:USERPROFILE)) {
    if (!$prefix) { continue }
    foreach ($variant in @($prefix, $prefix.Replace('\', '/'))) {
      if ($utf8.Contains($variant) -or $utf16.Contains($variant)) {
        throw 'Release contains a local build path. Do not distribute the generated installer.'
      }
    }
  }
  Write-Output 'Release privacy check: local workspace/profile paths absent from executable.'
} finally {
  [Environment]::SetEnvironmentVariable('CARGO_ENCODED_RUSTFLAGS', $previousFlags, 'Process')
  Set-Location -LiteralPath $previousLocation.Path
}
