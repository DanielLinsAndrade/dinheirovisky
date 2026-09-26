param([int]$TargetPid, [string]$FilePath, [string]$AllowedRoot, [switch]$Cancel)
$ErrorActionPreference = 'Stop'
if (!$Cancel) {
  $allowed = [IO.Path]::GetFullPath($AllowedRoot) + [IO.Path]::DirectorySeparatorChar
  $resolved = [IO.Path]::GetFullPath($FilePath)
  if (!$resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Only validation files are allowed.' }
}
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public class FileDialogTest {
 public delegate bool Callback(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h,Callback c,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h,uint msg,IntPtr w,StringBuilder l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h,uint msg,IntPtr w,string l);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds(20)
do {
  $dialogs = [Collections.Generic.List[IntPtr]]::new()
  [void][FileDialogTest]::EnumWindows({param($h,$l) [uint32]$p=0; [void][FileDialogTest]::GetWindowThreadProcessId($h,[ref]$p); $c=[Text.StringBuilder]::new(100); [void][FileDialogTest]::GetClassName($h,$c,100); if ($p -eq $TargetPid -and $c.ToString() -eq '#32770') {$dialogs.Add($h)}; return $true},[IntPtr]::Zero)
  foreach ($dialog in $dialogs) {
    $edits = [Collections.Generic.List[IntPtr]]::new()
    [void][FileDialogTest]::EnumChildWindows($dialog,{param($h,$l) $c=[Text.StringBuilder]::new(100); [void][FileDialogTest]::GetClassName($h,$c,100); if ($c.ToString() -eq 'Edit' -and [FileDialogTest]::GetDlgCtrlID($h) -in @(1001,1148)) {$edits.Add($h)}; return $true},[IntPtr]::Zero)
    if ($edits.Count -eq 1 -and [FileDialogTest]::IsWindowEnabled($edits[0])) {
      if (!$Cancel) {
        if ([FileDialogTest]::SendMessage($edits[0],0x000C,[IntPtr]::Zero,$resolved) -eq [IntPtr]::Zero) {continue}
        # The shell may still initialize/reset its filename control. Confirm
        # the requested synthetic path remains in the field before accepting.
        Start-Sleep -Milliseconds 150
        $actual=[Text.StringBuilder]::new(32768)
        [void][FileDialogTest]::SendMessage($edits[0],0x000D,[IntPtr]32768,$actual)
        if ($actual.ToString() -ne $resolved) {continue}
      }
      $button = if ($Cancel) {2} else {1}
      [void][FileDialogTest]::PostMessage($dialog,0x0111,[IntPtr]$button,[IntPtr]::Zero)
      while ([FileDialogTest]::IsWindow($dialog) -and [DateTime]::UtcNow -lt $deadline) {Start-Sleep -Milliseconds 100}
      if ([FileDialogTest]::IsWindow($dialog)) {throw 'Target file dialog did not close after confirmed filename submission.'}
      Write-Output 'File dialog submitted.'
      exit 0
    }
  }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Target file dialog was not found.'
