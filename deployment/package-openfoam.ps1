param([switch]$Deploy)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bundleParent = Join-Path $repoRoot '.local-logs'
New-Item -ItemType Directory -Force -Path $bundleParent | Out-Null
$bundleRoot = Join-Path $bundleParent ('openfoam-deploy-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $bundleRoot | Out-Null
Push-Location $repoRoot
try {
    # Tracked runtime inputs only; never a recursive upload of a dirty checkout.
    $runtimeFiles = @(git ls-files backend geometry database cad fixtures data 'frontend/lib/*.json') + @(
        'pyproject.toml', 'uv.lock', '.dockerignore',
        'backend/app/openfoam_case.py', 'backend/app/openfoam_runtime.py',
        'backend/app/openfoam_service.py', 'backend/app/openfoam_smoke.py',
        'backend/app/openfoam_telemetry.py',
        'deployment/Dockerfile.openfoam', 'deployment/openfoam-entrypoint.sh'
    )
    foreach ($file in ($runtimeFiles | Sort-Object -Unique)) {
        if ($file -match '(^|/)(\.env|[^/]*\.sqlite3)' -or $file -match '\.(pyc|FCStd)$') { continue }
        $sourcePath = Join-Path $repoRoot $file
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
        $destinationPath = Join-Path $bundleRoot $file
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationPath) | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'deployment/Dockerfile.openfoam') -Destination (Join-Path $bundleRoot 'Dockerfile')
    Write-Output $bundleRoot
    if ($Deploy) {
        pnpm dlx @railway/cli up $bundleRoot --path-as-root --service 535fa69d-bd31-4595-bec3-b2a00c1f66b1 --environment e1e7e064-a93e-4c5d-8f96-fa21dcc00e2b --project 45ec36d9-5b66-437c-a1b3-d85bdfb5a97f --detach -m 'Bounded OpenFOAM worker - runtime acceptance gated'
        if ($LASTEXITCODE -ne 0) { throw 'Railway upload failed.' }
    }
} finally { Pop-Location }
