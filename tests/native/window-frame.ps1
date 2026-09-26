param([int]$TargetPid, [ValidateSet('restore','resize')][string]$Action)
$ErrorActionPreference = 'Stop'
$target = Get-Process -Id $TargetPid
$allowed = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.validation/acceptance')) + [IO.Path]::DirectorySeparatorChar
if (!$target.Path.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Only the isolated acceptance process is allowed.' }
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public class FrameTest {
 public delegate bool Callback(IntPtr h,IntPtr l);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect rect);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder text,int length);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
}
'@
$handles = [Collections.Generic.List[IntPtr]]::new()
[void][FrameTest]::EnumWindows({param($h,$l) [uint32]$p=0; [void][FrameTest]::GetWindowThreadProcessId($h,[ref]$p); $title=[Text.StringBuilder]::new(256); [void][FrameTest]::GetWindowText($h,$title,256); if ($p -eq $TargetPid -and $title.ToString().StartsWith('Dinheirovisky')) {$handles.Add($h)}; return $true},[IntPtr]::Zero)
if ($handles.Count -ne 1) { throw 'Expected exactly one acceptance window.' }
$handle = $handles[0]
switch ($Action) {
 'restore' { [void][FrameTest]::ShowWindow($handle,4) }
 'resize' {
   if (![FrameTest]::SetWindowPos($handle,[IntPtr]::Zero,0,0,1000,740,0x16)) {throw 'Resize failed'}
   $rect=[FrameTest+Rect]::new()
   [void][FrameTest]::GetWindowRect($handle,[ref]$rect)
   $points=@(@(($rect.Left+1),[int](($rect.Top+$rect.Bottom)/2),10),@(($rect.Right-1),[int](($rect.Top+$rect.Bottom)/2),11),@([int](($rect.Left+$rect.Right)/2),($rect.Bottom-1),15))
   foreach($point in $points) {
     $packed=($point[0] -band 0xffff) -bor (($point[1] -band 0xffff) -shl 16)
     $hit=[FrameTest]::SendMessage($handle,0x84,[IntPtr]::Zero,[IntPtr]$packed).ToInt32()
     if($hit -ne $point[2]) {throw "Resize border hit-test failed: expected $($point[2]), got $hit"}
   }
   Write-Output 'Native resize border hit-tests passed.'
 }
}
