param([Parameter(Mandatory=$true)][string]$LegacyInstaller)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $repo
$old = [IO.Path]::GetFullPath($LegacyInstaller)
if([IO.Path]::GetFileName($old) -ne 'Dinheirovisk Acceptance_0.1.0_x64-setup.exe'){throw 'Use the isolated SPEC1 Acceptance installer, never production.'}
if(Get-Process dinheirovisk -ErrorAction SilentlyContinue){throw 'Close running application instances before this test.'}
if(Get-NetTCPConnection -LocalPort 9225 -State Listen -ErrorAction SilentlyContinue){throw 'Port 9225 is in use.'}
# NSIS retains its install-location hint when keeping app data. Clear only stale
# hints left by our isolated tests, so each run exercises the SPEC1 upgrade anew.
foreach($name in @('Dinheirovisk Acceptance','Dinheirovisky Acceptance')) {
  $hintKey = "HKCU:\Software\dinheirovisk\$name"
  if(Test-Path -LiteralPath $hintKey) {
    $hint = (Get-Item -LiteralPath $hintKey).GetValue('')
    if($hint) {
      $allowedHint = [IO.Path]::GetFullPath((Join-Path $repo '.validation')) + [IO.Path]::DirectorySeparatorChar
      if(![IO.Path]::GetFullPath($hint).StartsWith($allowedHint,[StringComparison]::OrdinalIgnoreCase)){throw 'Test installation hint belongs to another location.'}
      if(Test-Path -LiteralPath (Join-Path $hint 'dinheirovisk.exe')){throw "Uninstall the previous isolated test first: $hint"}
      Remove-Item -LiteralPath $hintKey
    }
  }
}
$new = Join-Path $repo 'src-tauri/target/release/bundle/nsis/Dinheirovisky Acceptance_0.1.0_x64-setup.exe'
if(!(Test-Path -LiteralPath $old) -or !(Test-Path -LiteralPath $new)){throw 'Build the new isolated installer and provide the old one.'}
$output = Join-Path $repo ('.validation/branding/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$install = Join-Path $output 'installed'
New-Item -ItemType Directory -Path $output | Out-Null
$exe = Join-Path $install 'dinheirovisk.exe'
try {
  $p = Start-Process -FilePath $old -ArgumentList @('/S',"/D=$install") -WindowStyle Hidden -PassThru -Wait
  if($p.ExitCode -ne 0){throw 'Legacy installation failed'}
  & node --experimental-sqlite tests/native/branding.cjs before $exe $output
  if($LASTEXITCODE -ne 0){throw 'Legacy fixture failed'}
  # Omit /D: the new installer must discover the original installation itself.
  $p = Start-Process -FilePath $new -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
  if($p.ExitCode -ne 0){throw 'Upgrade failed'}
  Copy-Item -LiteralPath $exe -Destination (Join-Path $output 'installed-after.exe')
  Get-ItemProperty -LiteralPath 'HKCU:\Software\dinheirovisk\Dinheirovisky Acceptance' -ErrorAction SilentlyContinue | Format-List | Out-File (Join-Path $output 'installation-path.txt')
  & node tests/native/verify-installed.cjs $exe src-tauri/target/release/dinheirovisk.exe
  if($LASTEXITCODE -ne 0){throw 'Upgrade did not replace the original binary'}
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Dinheirovisky Acceptance'
  $registration = Get-ItemProperty -LiteralPath $key
  if($registration.DisplayName -ne 'Dinheirovisky Acceptance'){throw 'Visible registration name not updated'}
  if(Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Dinheirovisk Acceptance'){throw 'Legacy uninstall registration was not migrated'}
  & node --experimental-sqlite tests/native/branding.cjs after $exe $output
  if($LASTEXITCODE -ne 0){throw 'Branding/data preservation validation failed'}
} finally {
  $allowed = [IO.Path]::GetFullPath((Join-Path $repo '.validation/branding')) + [IO.Path]::DirectorySeparatorChar
  if(!$install.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe uninstall path'}
  $uninstaller = Join-Path $install 'uninstall.exe'
  if(Test-Path -LiteralPath $uninstaller) {
    $p = Start-Process -FilePath $uninstaller -ArgumentList @('/S',"_?=$install") -WindowStyle Hidden -PassThru -Wait
    if($p.ExitCode -ne 0 -or (Test-Path -LiteralPath $exe)){throw 'Isolated uninstallation failed'}
  }
}
Write-Output "Branding upgrade validation passed: $output"
