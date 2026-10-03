[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$startScript = Join-Path $appRoot 'scripts\Start-Daylight.ps1'
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'Daylight Local Tasks.lnk'

if ($Remove) {
    if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
    Write-Host 'Daylight sign-in startup was removed.'
    exit 0
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '" -NoBrowser'
$shortcut.WorkingDirectory = $appRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Start Daylight local task reminders and schedules after Windows sign-in.'
$shortcut.Save()
Write-Host 'Daylight will start in the background after your next Windows sign-in.'
Write-Host 'It does not wake a sleeping computer. Remove with Register-Startup.ps1 -Remove.'
