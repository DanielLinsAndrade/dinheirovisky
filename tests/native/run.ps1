param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $repo
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$runRoot = Join-Path $repo ('.validation/acceptance/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$installRoot = Join-Path $runRoot 'installed'
$acceptanceRoot = [IO.Path]::GetFullPath((Join-Path $repo '.validation/acceptance')) + [IO.Path]::DirectorySeparatorChar
$runningAcceptance = @(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($acceptanceRoot,[StringComparison]::OrdinalIgnoreCase) })
if ($runningAcceptance.Count -gt 0) { throw 'An isolated acceptance instance is already running. Preserve it and retry after its owner finishes.' }
New-Item -ItemType Directory -Path $runRoot | Out-Null
function Checked([string]$Tool, [string[]]$Arguments) {
  & $Tool @Arguments
  if($LASTEXITCODE -ne 0) { throw "$Tool failed ($LASTEXITCODE)" }
}
if(!$SkipBuild) {
  Checked 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/build-release.ps1','-Config','tests/native/tauri.conf.json')
}
$installer = Join-Path $repo 'src-tauri/target/release/bundle/nsis/Dinheirovisky Acceptance_1.0.0_x64-setup.exe'
if(!(Test-Path -LiteralPath $installer)){throw 'Isolated installer missing. Run without -SkipBuild.'}
$installed = Start-Process -FilePath $installer -ArgumentList @('/S',"/D=$installRoot") -PassThru -Wait -WindowStyle Hidden
if($installed.ExitCode -ne 0){throw "Installation failed: $($installed.ExitCode)"}
$exe = Join-Path $installRoot 'dinheirovisk.exe'
try {
  if(!(Test-Path -LiteralPath $exe)){throw 'Installed executable missing'}
  Checked 'node.exe' @('tests/native/verify-installed.cjs',$exe,'src-tauri/target/release/dinheirovisk.exe')
  Checked 'node.exe' @('--experimental-sqlite','tests/native/run.cjs',$exe,$runRoot)
} finally {
  # Only the unique isolated installation is eligible for uninstallation.
  $allowed = [IO.Path]::GetFullPath((Join-Path $repo '.validation/acceptance')) + [IO.Path]::DirectorySeparatorChar
  if(!$installRoot.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe install path'}
  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter '*uninstall*.exe')
  if($uninstallers.Count -eq 1) {
    $uninstalled = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList @('/S',"_?=$installRoot") -PassThru -Wait -WindowStyle Hidden
    if($uninstalled.ExitCode -ne 0){throw 'Uninstallation failed'}
    if(Test-Path -LiteralPath $exe){throw 'Uninstaller retained application executable'}
    'Installation and uninstallation passed.' | Set-Content (Join-Path $runRoot 'installation.txt')
  } else { throw 'Expected one isolated uninstaller' }
}
Write-Output "Acceptance artifacts: $runRoot"
