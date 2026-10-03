[CmdletBinding()]
param([ValidateRange(1024, 65535)][int]$Port = 4317)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules\@modelcontextprotocol\sdk'))) {
    throw 'Run Start-Daylight.cmd first to install the dependencies.'
}

# The shared manager registers only a missing entry and checks its MCP health.
# Existing entries, including desktop Electron connections and policies, survive.
$helperPath = Join-Path $PSScriptRoot 'connect-codex-mcp.mjs'
& $nodePath $helperPath '--port' ([string]$Port)
if ($LASTEXITCODE -ne 0) { throw 'Daylight MCP connection was not verified. See the message above; existing registrations were preserved.' }
