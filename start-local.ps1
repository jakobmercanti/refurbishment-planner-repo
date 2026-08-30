[CmdletBinding()]
param(
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Join-Path $projectRoot "frontend"
$logRoot = Join-Path $projectRoot ".local-logs"

function Test-PortInUse {
  param([int]$Port)
  return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Find-CommandPath {
  param([string]$Name, [string[]]$Fallbacks)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($fallback in $Fallbacks) {
    if (Test-Path -LiteralPath $fallback) { return $fallback }
  }
  throw "Could not find $Name. Install it or update the fallback location in start-local.ps1."
}

if (!(Test-Path -LiteralPath (Join-Path $projectRoot "backend\app\main.py"))) {
  throw "This script must be run from the refurbishment planner project folder."
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$nodePath = Find-CommandPath "node" @(
  "C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
$pnpmPath = Find-CommandPath "pnpm" @(
  "C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
)
$nodeDirectory = Split-Path -Parent $nodePath
$backendLog = Join-Path $logRoot "backend.log"
$frontendLog = Join-Path $logRoot "frontend.log"

if (Test-PortInUse 8000) {
  Write-Host "Backend already running at http://127.0.0.1:8000"
} else {
  # Keep uv's cache inside the project. The default user cache can be read-only
  # on managed Windows profiles, which otherwise leaves the frontend showing a
  # misleading API 500 while the backend process fails during startup.
  $backendCache = Join-Path $projectRoot ".uv-cache"
  $backendCommand = "`$env:UV_CACHE_DIR = '$backendCache'; Set-Location -LiteralPath '$projectRoot'; uv run uvicorn backend.app.main:app --reload *>&1 | Tee-Object -FilePath '$backendLog'"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) -WindowStyle Hidden
  Write-Host "Starting backend at http://127.0.0.1:8000"
}

if (Test-PortInUse 3000) {
  Write-Host "Frontend already running at http://localhost:3000"
} else {
  $frontendCommand = "`$env:PATH = '$nodeDirectory;' + `$env:PATH; Set-Location -LiteralPath '$frontendRoot'; & '$pnpmPath' dev *>&1 | Tee-Object -FilePath '$frontendLog'"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) -WindowStyle Hidden
  Write-Host "Starting frontend at http://localhost:3000"
}

Write-Host ""
Write-Host "Open the application: http://localhost:3000"
$lanAddress = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
  Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
  ForEach-Object { $_.IPv4Address.IPAddress } |
  Select-Object -First 1
if ($lanAddress) {
  Write-Host "Open on same Wi-Fi:  http://${lanAddress}:3000"
}
Write-Host "Backend API:           http://127.0.0.1:8000/docs"
Write-Host "Logs:                  $logRoot"

if ($OpenBrowser) {
  Start-Process "http://localhost:3000"
}
