param([switch]$Deploy)
if ($Deploy) { throw 'The replacement API was cancelled. Its deployment is stopped. Do not reactivate it with this historical helper; use an explicitly reviewed release plan for the original backend.' }
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bundleParent = Join-Path $repoRoot '.local-logs'
New-Item -ItemType Directory -Force -Path $bundleParent | Out-Null
$bundleRoot = Join-Path $bundleParent ('freefloorplan-api-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $bundleRoot | Out-Null
Push-Location $repoRoot
try {
    # Only API runtime inputs; never upload credentials, browser projects,
    # local databases, unrelated nested repositories or the dirty checkout.
    $runtimeFiles = @(git ls-files backend geometry database cad fixtures data 'frontend/lib/*.json' frontend/public) + @(
        'pyproject.toml', 'uv.lock', '.dockerignore', 'Dockerfile', 'railway.json',
        'backend/app/climoptix_defaults.py', 'backend/app/openfoam_progress.py'
    )
    foreach ($file in ($runtimeFiles | Sort-Object -Unique)) {
        if ($file -match '(^|/)(\.env|[^/]*\.sqlite3)' -or $file -match '\.(pyc|FCStd)$') { continue }
        $sourcePath = Join-Path $repoRoot $file
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Missing API runtime file: $file" }
        $destinationPath = Join-Path $bundleRoot $file
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationPath) | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
    }
    Write-Output $bundleRoot
    if ($Deploy) {
        # This replacement is deliberately separate from the fallback API.
        pnpm dlx @railway/cli up $bundleRoot --path-as-root --service a680ebe4-8ec9-4f97-9240-ca000a984d2d --environment e1e7e064-a93e-4c5d-8f96-fa21dcc00e2b --project 45ec36d9-5b66-437c-a1b3-d85bdfb5a97f --detach -m 'FreeFloorplan replacement API - tested bounded runtime snapshot'
        if ($LASTEXITCODE -ne 0) { throw 'Railway API upload failed.' }
    }
} finally { Pop-Location }
