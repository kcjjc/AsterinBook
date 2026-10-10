param([int]$ProcessId)
$taskAll = Get-CimInstance Win32_Process
$taskIds = [Collections.Generic.HashSet[int]]::new();[void]$taskIds.Add($ProcessId)
do {$taskAdded=$false;foreach($taskItem in $taskAll){if($taskIds.Contains([int]$taskItem.ParentProcessId) -and $taskIds.Add([int]$taskItem.ProcessId)){$taskAdded=$true}}}while($taskAdded)
$taskMain = Get-Process -Id $ProcessId
$taskChildren = @($taskIds | ForEach-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue})
[ordered]@{mainWorkingSetMiB=[Math]::Round($taskMain.WorkingSet64/1MB,1);mainPrivateMiB=[Math]::Round($taskMain.PrivateMemorySize64/1MB,1);totalWorkingSetMiB=[Math]::Round(($taskChildren | Measure-Object WorkingSet64 -Sum).Sum/1MB,1);totalPrivateMiB=[Math]::Round(($taskChildren | Measure-Object PrivateMemorySize64 -Sum).Sum/1MB,1);processes=$taskChildren.Count} | ConvertTo-Json -Compress
