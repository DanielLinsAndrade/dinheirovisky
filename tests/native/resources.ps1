param([int]$TargetPid)
$ErrorActionPreference = 'Stop'
$tree = Get-CimInstance Win32_Process
$ids = @($TargetPid)
for($i=0;$i -lt 6;$i++) {
  $ids += @($tree | Where-Object { $_.ParentProcessId -in $ids } | Select-Object -ExpandProperty ProcessId)
  $ids = @($ids | Select-Object -Unique)
}
@(Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64,CPU) | ConvertTo-Json -Compress
