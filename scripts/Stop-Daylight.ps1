[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$entryPath = Join-Path $appRoot 'server\index.mjs'
$pidPath = Join-Path $appRoot '.runtime\daylight-process.json'
if (-not (Test-Path -LiteralPath $pidPath)) {
    Write-Host 'No Daylight launcher process is recorded. A manually started service must be stopped in its terminal.'
    exit 0
}

$record = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
if ($record.script -ne $entryPath -or [int]$record.pid -le 0) {
    throw 'The saved process record does not belong to this Daylight installation.'
}
$process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
if ($null -eq $process) {
    Remove-Item -LiteralPath $pidPath
    Write-Host 'Daylight has already stopped.'
    exit 0
}

$info = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
$sameStart = [Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTime]::Parse($record.startedAt).ToUniversalTime()).TotalSeconds) -lt 2
$sameScript = $info.CommandLine -and $info.CommandLine.IndexOf($entryPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
$sameExe = $info.ExecutablePath -and $info.ExecutablePath -eq $record.executable
if (-not ($sameStart -and $sameScript -and $sameExe)) {
    throw 'Process identity no longer matches Daylight. Nothing was stopped.'
}

& "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the recorded Daylight process tree.' }
Remove-Item -LiteralPath $pidPath
Write-Host 'Daylight stopped. Reminders and scheduled Codex runs are paused until it starts again.'
