[CmdletBinding()]
param(
  [switch]$OpenBrowser,
  [switch]$RestartExisting
)

$ErrorActionPreference = "Stop"

# Windows PowerShell started from a .cmd file may inherit both PATH and Path.
# Start-Process treats those names as duplicate dictionary keys, so collapse
# them to one entry before launching either local service.
$pathValue = $env:Path
Remove-Item Env:Path -ErrorAction SilentlyContinue
$env:Path = $pathValue

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Join-Path $projectRoot "frontend"
$logRoot = Join-Path $projectRoot ".local-logs"

function Test-BackendHealthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-FrontendHealthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3000" -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Get-PortListener {
  param([int]$Port)
  try {
    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    if ($connections.Count) { return @($connections | Sort-Object OwningProcess -Unique) }
  } catch {
    # Some Windows environments deny Get-NetTCPConnection even though netstat is available.
  }

  return @(Get-NetstatListener | Where-Object LocalPort -eq $Port)
}

function Get-NetstatListener {
  $listeners = foreach ($line in @(netstat -ano -p tcp 2>$null)) {
    if ($line -match '^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
      [pscustomobject]@{
        LocalPort = [int]$Matches[1]
        OwningProcess = [int]$Matches[2]
        State = "Listen"
      }
    }
  }
  return @($listeners | Sort-Object OwningProcess -Unique)
}

function Get-ProcessDescription {
  param([int]$ProcessId)
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    return "$($process.ProcessName) (PID $ProcessId)"
  } catch {
    return "an unknown process (PID $ProcessId)"
  }
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop).CommandLine
  } catch {
    return $null
  }
}

function Get-ProcessName {
  param([int]$ProcessId)
  try {
    return (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName
  } catch {
    return $null
  }
}

function Get-ProcessPath {
  param([int]$ProcessId)
  try {
    return (Get-Process -Id $ProcessId -ErrorAction Stop).Path
  } catch {
    return $null
  }
}

function Get-KnownNodePaths {
  $paths = @(
    "C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  )
  try {
    $command = Get-Command node -ErrorAction Stop
    if ($command.Source) { $paths += $command.Source }
  } catch {
    # The fixed fallback above is sufficient when node is not on PATH.
  }
  return @($paths | Where-Object { $_ } | Select-Object -Unique)
}

function Test-ManagedServiceProcess {
  param(
    [int]$ProcessId,
    [ValidateSet("backend", "frontend")]
    [string]$Service
  )
  $commandLine = Get-ProcessCommandLine $ProcessId
  if ($commandLine) {
    if ($Service -eq "backend") {
      return $commandLine -match "(?i)(uvicorn|backend\.app\.main:app)"
    }
    # `next dev` hands the listening socket to a child Node process whose
    # command line is `next/dist/server/lib/start-server.js`; that child no
    # longer contains the literal `dev` argument.  Match the project path and
    # Next's server entrypoint so refreshes stop the actual Renovation Fit
    # frontend instead of rejecting it as an unrelated Node process.
    $frontendMarker = [regex]::Escape(([IO.Path]::GetFullPath($frontendRoot)).TrimEnd('\'))
    if ($commandLine -match "(?i)$frontendMarker[\\/].*start-server\.js") { return $true }
    if ($commandLine -match "(?i)$frontendMarker[\\/].*next[\\/].*" -and $commandLine -match "(?i)(^|\s)dev(\s|$)") { return $true }
    return $false
  }

  # Fall back to the executable name when process command lines are unavailable
  # (for example, under restricted Windows service accounts).
  $processName = Get-ProcessName $ProcessId
  if ($Service -eq "backend") {
    return $processName -match "(?i)^(python(?:\d+(?:\.\d+)?)?|uvicorn)$"
  }
  if ($processName -notmatch "(?i)^node$") { return $false }
  $processPath = Get-ProcessPath $ProcessId
  if ($processPath) {
    return (Get-KnownNodePaths) -contains $processPath
  }
  return $true
}

function Stop-ExistingService {
  param(
    [int]$Port,
    [ValidateSet("backend", "frontend")]
    [string]$Service
  )
  $listeners = @(Get-PortListener $Port)
  if ($Service -eq "frontend" -and !$listeners.Count -and (Test-Path -LiteralPath (Join-Path $frontendRoot ".next\dev\lock"))) {
    # Next can leave its dev server on a fallback port (for example 3010) when
    # its development lock is held. Refresh any matching Node listener too.
    $knownNodePaths = @(Get-KnownNodePaths)
    $listeners = @(Get-NetstatListener | Where-Object {
      $processId = $_.OwningProcess
      $processName = Get-ProcessName $processId
      $processPath = Get-ProcessPath $processId
      $processName -match "(?i)^node$" -and (!$processPath -or $knownNodePaths -contains $processPath)
    })
  }
  if (!$listeners.Count) { return }
  $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($processId in $processIds) {
    if (!(Test-ManagedServiceProcess -ProcessId $processId -Service $Service)) {
      $owner = Get-ProcessDescription $processId
      throw "Cannot refresh the ${Service}: port $Port is owned by $owner, which is not a Renovation Fit process. Close it, then run this launcher again."
    }
    Write-Host "Stopping existing $Service ($((Get-ProcessDescription $processId)))"
    # taskkill can terminate the complete process tree even when WMI process
    # enumeration is unavailable to the current Windows account.
    $taskkillSucceeded = $false
    try {
      & taskkill.exe /PID $processId /T /F 2>&1 | Out-Null
      $taskkillSucceeded = $LASTEXITCODE -eq 0
    } catch {
      $taskkillSucceeded = $false
    }
    if (!$taskkillSucceeded) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    $remainingListeners = @(Get-PortListener $Port)
    if ($remainingListeners.Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "The existing $Service did not release port $Port."
}

function Start-LoggedProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$OutputLog,
    [string]$ErrorLog
  )
  Set-Content -LiteralPath $OutputLog -Value "" -NoNewline
  Set-Content -LiteralPath $ErrorLog -Value "" -NoNewline
  try {
    return Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $OutputLog -RedirectStandardError $ErrorLog -ErrorAction Stop
  } catch {
    if ($_.Exception.Message -notmatch "already been added.*PATH") { throw }
    # Windows PowerShell can expose both Path and PATH when launched from a
    # .cmd file. Start-Process cannot build its environment dictionary then,
    # so retry with the clean system environment (all paths are absolute).
    return Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -UseNewEnvironment -PassThru -RedirectStandardOutput $OutputLog -RedirectStandardError $ErrorLog -ErrorAction Stop
  }
}

function Show-StartupFailure {
  param([string]$Service, [string]$OutputLog, [string]$ErrorLog)
  Write-Host ""
  Write-Host "$Service did not start. Recent error output:" -ForegroundColor Red
  foreach ($log in @($ErrorLog, $OutputLog)) {
    if (Test-Path -LiteralPath $log) {
      Get-Content -LiteralPath $log -Tail 30 -ErrorAction SilentlyContinue | Write-Host
    }
  }
  throw "$Service did not become healthy. Logs: $OutputLog and $ErrorLog"
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

function Test-BackendPythonEnvironment {
  param([string]$PythonPath)
  if (!(Test-Path -LiteralPath $PythonPath)) { return $false }
  try {
    & $PythonPath -c "import click, uvicorn; assert hasattr(click, 'Choice')" 2>$null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

if (!(Test-Path -LiteralPath (Join-Path $projectRoot "backend\app\main.py"))) {
  throw "This script must be run from the refurbishment planner project folder."
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

if ($RestartExisting) {
  Write-Host "Refreshing existing local services..."
  Stop-ExistingService -Port 8000 -Service "backend"
  Stop-ExistingService -Port 3000 -Service "frontend"
}

$nodePath = Find-CommandPath "node" @(
  "C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$backendOutputLog = Join-Path $logRoot "backend.out.log"
$backendErrorLog = Join-Path $logRoot "backend.err.log"
$frontendOutputLog = Join-Path $logRoot "frontend.out.log"
$frontendErrorLog = Join-Path $logRoot "frontend.err.log"

if (Test-BackendHealthy) {
  Write-Host "Backend already running at http://127.0.0.1:8000"
} else {
  $backendListener = Get-PortListener 8000
  if ($backendListener) {
    $owner = Get-ProcessDescription $backendListener.OwningProcess
    throw "Port 8000 is already used by $owner, but it is not the Renovation Fit backend. Close that process, then run this launcher again."
  }
  if (Test-Path -LiteralPath $venvPython) {
    if (!(Test-BackendPythonEnvironment -PythonPath $venvPython)) {
      $uvPath = Find-CommandPath "uv" @()
      Write-Host "Refreshing incomplete Python environment from uv.lock"
      & $uvPath sync --locked
      if ($LASTEXITCODE -ne 0 -or !(Test-BackendPythonEnvironment -PythonPath $venvPython)) {
        throw "The local Python environment could not be repaired from uv.lock."
      }
    }
    $backendProcess = Start-LoggedProcess -FilePath $venvPython -ArgumentList @("-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000") -WorkingDirectory $projectRoot -OutputLog $backendOutputLog -ErrorLog $backendErrorLog
  } else {
    $uvPath = Find-CommandPath "uv" @()
    $backendProcess = Start-LoggedProcess -FilePath $uvPath -ArgumentList @("run", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000") -WorkingDirectory $projectRoot -OutputLog $backendOutputLog -ErrorLog $backendErrorLog
  }
  Write-Host "Starting backend at http://127.0.0.1:8000"
}

$backendReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  if (Test-BackendHealthy) { $backendReady = $true; break }
  if ($backendProcess -and $backendProcess.HasExited) { break }
  Start-Sleep -Milliseconds 500
}
if (!$backendReady) {
  Show-StartupFailure -Service "The engineering backend" -OutputLog $backendOutputLog -ErrorLog $backendErrorLog
}

if (Test-FrontendHealthy) {
  Write-Host "Frontend already running at http://localhost:3000"
} else {
  $frontendListener = Get-PortListener 3000
  if ($frontendListener) {
    $owner = Get-ProcessDescription $frontendListener.OwningProcess
    throw "Port 3000 is already used by $owner, but it is not a healthy Renovation Fit frontend. Close that process, then run this launcher again."
  }
  $nextBinaryRelative = "node_modules\next\dist\bin\next"
  $nextBinary = Join-Path $frontendRoot $nextBinaryRelative
  if (!(Test-Path -LiteralPath $nextBinary)) {
    $pnpmPath = Find-CommandPath "pnpm" @(
      "C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
    )
    throw "Frontend dependencies are missing. Run '$pnpmPath install' from $frontendRoot once, then start the launcher again."
  }
  # Use a path relative to the working directory so Start-Process does not split
  # the project path when its folder name contains spaces.
  $frontendProcess = Start-LoggedProcess -FilePath $nodePath -ArgumentList @($nextBinaryRelative, "dev") -WorkingDirectory $frontendRoot -OutputLog $frontendOutputLog -ErrorLog $frontendErrorLog
  Write-Host "Starting frontend at http://localhost:3000"
}

$frontendReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  if (Test-FrontendHealthy) { $frontendReady = $true; break }
  if ($frontendProcess -and $frontendProcess.HasExited) { break }
  Start-Sleep -Milliseconds 500
}
if (!$frontendReady) {
  Show-StartupFailure -Service "The frontend" -OutputLog $frontendOutputLog -ErrorLog $frontendErrorLog
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
  try {
    Start-Process "http://localhost:3000" -ErrorAction Stop
  } catch {
    Write-Host "Could not open the browser automatically; open http://localhost:3000 manually."
  }
}
