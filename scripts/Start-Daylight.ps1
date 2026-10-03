[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$Rebuild,
    [ValidateRange(1024, 65535)][int]$Port = 4317
)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $appRoot '.runtime'
$entryPath = Join-Path $appRoot 'server\index.mjs'
$pidPath = Join-Path $runtimeDir 'daylight-process.json'
$appUrl = "http://127.0.0.1:$Port"

function Test-DaylightReady {
    try {
        $state = Invoke-RestMethod -Uri "$appUrl/api/bootstrap" -TimeoutSec 2
        return ($null -ne $state.tasks -and $null -ne $state.projects -and $state.csrfToken)
    } catch { return $false }
}

if (Test-DaylightReady) {
    Write-Host "Daylight is already running: $appUrl"
    if (-not $NoBrowser) { Start-Process $appUrl }
    exit 0
}

$nodePath = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$npmPath = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
Push-Location $appRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules\.bin\vite.cmd')) -or
        -not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules\@modelcontextprotocol\sdk'))) {
        Write-Host 'Installing Daylight dependencies...'
        & $npmPath install
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    if ($Rebuild -or -not (Test-Path -LiteralPath (Join-Path $appRoot 'dist\index.html'))) {
        Write-Host 'Building Daylight...'
        & $npmPath run build
        if ($LASTEXITCODE -ne 0) { throw 'Daylight build failed.' }
    }
} finally { Pop-Location }

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$stdoutPath = Join-Path $runtimeDir 'server.log'
$stderrPath = Join-Path $runtimeDir 'server-error.log'
$oldPort = $env:DAYLIGHT_PORT
try {
    $env:DAYLIGHT_PORT = "$Port"
    $process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $entryPath + '"') `
        -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
} finally { $env:DAYLIGHT_PORT = $oldPort }

$deadline = (Get-Date).AddSeconds(20)
do {
    Start-Sleep -Milliseconds 300
    $process.Refresh()
    if ($process.HasExited) {
        throw "Daylight stopped during startup. Read $stderrPath"
    }
    if (Test-DaylightReady) {
        @{ pid = $process.Id; script = $entryPath; executable = $nodePath; startedAt = $process.StartTime.ToUniversalTime().ToString('o'); port = $Port } |
            ConvertTo-Json | Set-Content -LiteralPath $pidPath -Encoding UTF8
        Write-Host "Daylight is ready: $appUrl"
        if (-not $NoBrowser) { Start-Process $appUrl }
        exit 0
    }
} while ((Get-Date) -lt $deadline)

# Only this newly created process is terminated after a failed startup.
if (-not $process.HasExited) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
}
throw "Daylight did not become ready. Read $stdoutPath and $stderrPath"
