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
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect("127.0.0.1", $Port)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Test-BackendHealthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
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
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$backendLog = Join-Path $logRoot "backend.log"
$frontendLog = Join-Path $logRoot "frontend.log"

if (Test-BackendHealthy) {
  Write-Host "Backend already running at http://127.0.0.1:8000"
} else {
  if (Test-Path -LiteralPath $venvPython) {
    $backendCommand = "Set-Location -LiteralPath '$projectRoot'; & '$venvPython' -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 *>&1 | Tee-Object -FilePath '$backendLog'"
  } else {
    # Keep uv's cache inside the project when bootstrapping a fresh checkout.
    $backendCache = Join-Path $projectRoot ".uv-cache"
    $backendCommand = "`$env:UV_CACHE_DIR = '$backendCache'; Set-Location -LiteralPath '$projectRoot'; uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 *>&1 | Tee-Object -FilePath '$backendLog'"
  }
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) -WindowStyle Hidden
  Write-Host "Starting backend at http://127.0.0.1:8000"
}

$backendReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  if (Test-BackendHealthy) { $backendReady = $true; break }
  Start-Sleep -Milliseconds 500
}
if (!$backendReady) {
  throw "The engineering backend did not become healthy. See $backendLog before starting the frontend."
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
$lanAddress = $null
try {
  $lanAddress = Get-NetIPConfiguration -ErrorAction Stop |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Select-Object -First 1
} catch {
  # The application can still run locally when Windows restricts network discovery.
}
if ($lanAddress) {
  Write-Host "Open on same Wi-Fi:  http://${lanAddress}:3000"
}
Write-Host "Backend API:           http://127.0.0.1:8000/docs"
Write-Host "Logs:                  $logRoot"

if ($OpenBrowser) {
  Start-Process "http://localhost:3000"
}
