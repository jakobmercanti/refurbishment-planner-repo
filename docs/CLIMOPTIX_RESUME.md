# Climoptix implementation — historical pause checkpoint

> Resumed at the user's request on 21 October 2026. The old failures and next-work
> list below have been addressed during that continuation. This file preserves
> the historical 20 October checkpoint; it is not the current outstanding-work
> list. See `docs/CLIMOPTIX.md` for current implementation, verified outcomes and
> explicitly staged geometry/provider limitations. No commit, push or deployment
> was made during the continuation.

Paused at the user's explicit request on 20 October 2026. Do not resume work
until asked. All edits are saved in the existing checkout. Nothing was committed
or pushed. All test/build processes started for this task have finished; none
remain running. This is a work-in-progress checkpoint, not a release sign-off.

## Request and source

Implement the user's Climoptix Codex prompt, found in Google Drive's
`P3 - Engineering toolset` folder. The complete 53,402-character prompt was read
and saved as `docs/CLIMOPTIX_BRIEF.txt`.

- Drive file: `Climoptix_Codex_Prompt.txt`
- File ID: `1-vRA_gfevpcFC2YJpv-vUOWq__7ZV6_a`
- Folder ID: `1aZd-gTJCRs_Y7tu4_D45YgJCDoHymXWD`
- Working tree: `C:/Users/Dell/Documents/ChatGPT/Online refurbishment planner`
- Current branch: `multifloors`; starting HEAD: `e5deb94e64512ddfd44df5d101ffe203392c2787`.

This is CFD **preparation only**. The prompt explicitly defers production volume
meshing, OpenFOAM execution, remote jobs, results and optimization. Never create
fake results or enable unsupported execution. Use the existing measured building,
storage and history; millimetres remain authoritative. Read root/frontend
`AGENTS.md` and relevant bundled Next.js documentation before further edits.

## Implemented, saved work

- Integrated Workspace → Climoptix CFD; scenario creation, duplication, naming,
  archive/delete confirmation, import/export and shared project persistence.
- Domain/equipment/boundary/physics/mesh/review/results panels, responsive and
  dark styling, context help, actual 2D/3D geometry preview and vent intent markers.
- Strict versioned Python/Pydantic and TypeScript/Zod scenario contracts, SI
  physics, thermal/CO2 sources, device flow units and future provider contracts.
- Deterministic domain discovery from source geometry. Permanent doorless
  passages and actual slab voids connect; doors/windows ALWAYS stop discovery,
  at every leaf/open state. Explicit caps retain editable boundary conditions.
- Interior flat, mono, gable, stepped and optional per-room ceilings; exact
  capped/mitred wall envelope and variable wall thickness in roof frames.
- Tagged conforming boundary skins, closure/orientation/volume checks,
  catalogue obstruction proxies, floor-contact cuts and real prism collisions.
- Stable corner-backed wall host identities (including closing/reversed runs),
  geometry-backed legacy identities, removed-host/orphan diagnostics and staleness.
- Device footprints, constraints, area/effective flow, group/per-patch BCs,
  mesh recipes and uncertain estimates, actionable diagnostics, provenance hashes.
- Stateless capabilities/preparation API; no run/job routes. Strict finite JSON,
  bounded 4 MiB streaming proxy, stripped unrelated private layout data.
- JSON/preparation ZIP; closed, current, error-free boundary STL in explicit
  metres, never advertised as a finite-volume mesh or runnable solver case.
- Five portable sample projects and independent developer-only Gmsh QA script.

Implementation/use/deferred-adapter documentation: `docs/CLIMOPTIX.md`.

### Main added files

`geometry/climoptix_models.py`, `geometry/climoptix_domain.py`,
`geometry/climoptix_surface.py`, `backend/app/climoptix_provider.py`,
`backend/app/climoptix_api.py`, `frontend/lib/climoptixDocument.ts`,
`frontend/lib/climoptix.ts`, `frontend/components/ClimoptixWorkspace.tsx`,
`frontend/components/ClimoptixPanels.tsx`,
`frontend/components/ClimoptixViewer.tsx`, `frontend/app/climoptix.css`,
`scripts/audit_climoptix.py` and corresponding Python/frontend/browser tests.

Existing integration files changed include backend main/commercial/building
validation, the public deployment worker, frontend project document/history/
repository/local-project hooks, application menu, layout and planner client.

## Verified at the pause

Logs are in `.local-logs/` (local ignored artifacts):

- Full Python suite: **546 passed**, one existing FastAPI/TestClient deprecation
  warning. `climoptix-full-pytest.log`.
- Climoptix Python tests alone: **78 passed**. `climoptix-python.log`.
- Full frontend unit tests: **534 passed**; project integration: **17 passed**.
  `climoptix-frontend-tests.log`.
- New Python/TypeScript contract tests: **7 passed**, including asymmetric-wall
  roof-height parity and strict response/geometry validation.
  `climoptix-contract-tests.log`.
- Worker/proxy tests: **12 passed**. `climoptix-worker.log`.
- Mypy: **52 source files clean**. `climoptix-mypy.log`.
- Scoped Ruff: **all checks passed**. `climoptix-ruff.log`.
- Frontend typecheck and production static export: **passed**.
  `climoptix-typecheck.log`, `climoptix-build.log`.
- Latest Climoptix browser audit: **4 passed, 2 failed**, detailed below.
  `climoptix-browser.log`. Do not report the browser audit as complete.
- Latest lint: **one test-file prefer-const error**, detailed below.
  `climoptix-lint.log`.

An earlier independent Gmsh check passed all five exported air skins, producing
positive tetrahedra and matching volumes. Repeat it after the latest geometry
changes. Evidence: `climoptix-independent-mesh.log` and
`.local-logs/climoptix-examples/`. These are QA cells, not app solver outputs.

## Exact next work, once resumed

1. **Fix completed-drag Undo grouping.** The new 2D drag succeeds, but pressing
   Undo immediately afterward can remove the vent: `ProjectHistory.record`
   coalesces edits within 500 ms, grouping the drag with Add/host/width edits.
   The test then fails reading an absent vent. Do not weaken the test or add a
   sleep to mask it. Give a committed drag its own history checkpoint.
   Suggested minimal plumbing:
   - `useLocalProject.update(changes, forceHistory = false)` →
     `history.current.record(p, next, forceHistory)`;
   - optional checkpoint argument in `setCFDScenarios`, workspace `onChange`
     and workspace `change`;
   - `moveVent` commits with checkpoint=true. Discrete add/delete/import actions
     may also use checkpoints, while text edits retain normal coalescing.
   - forward the optional flag in `planner-client.tsx`.
   No part of this suggested fix has been applied yet.
2. **Rerun the numeric browser test.** Its first failure was a test locator for
   a nonexistent `Air properties` summary; physics fields are already visible.
   That one erroneous click **has been removed**, but the test has not been rerun.
   The test checks rejected density stays at saved 1.204, valid scientific
   viscosity commits, and switching presets to Custom retains inputs.
3. **Fix lint** in `frontend/tests/browser/climoptix.browser.mts`: change
   `let pixel = goldPixel(...)` to `const`. Format the newly added browser tests.
4. **Actually verify 3D vent pick/drag.** The new real-image test has not reached
   its 3D part because of the Undo failure. It finds the gold selected marker in
   a canvas screenshot using local Pillow, then drags it. Ray picking now skips
   transparent walls/context/detailed assets when a vent is intersected, and
   pointer cancellation clears drag state; these still require final coverage.
5. Add a portable-example roundtrip test through frontend `inspectPackage` /
   `parseProject` if useful; all five already pass the real FastAPI endpoint.
6. Finish a prompt-to-implementation audit. Remaining possible UI gaps include
   visible jet arrows, prospective refinement-region highlighting, domain bounds,
   selected-patch isolation and richer future-results navigation. Implement
   proportionate preparation features or explicitly document remaining scope.
   Do not claim every detailed brief item is finished.
7. Rerun full type/lint/Python/frontend/worker checks, rebuild production export,
   then all browser tests, not just the Climoptix file. Do not rebuild `out/`
   while browser tests are reading it. Re-run the five independent Gmsh cases.
8. Visually inspect updated desktop/dark/mobile screenshots, verify handoff doc
   against exact final outcomes/limitations and review the diff for regressions.

### Important known staged geometry limits

Imported visual GLBs need a measured adapter; assembled opening balustrades need
contact/union handling; partial internal wall runs need a solid adapter. These
cases currently produce explicit blockers, not falsely complete fluid skins.
Nominal balustrade catalogue CFD proxies already exist from earlier work.
General proxy unions/clipping, porous/radiation models and source schedules are
also deferred. Preserve clear blockers and document these limitations.

## Commands / runtime

PowerShell. Tests use the existing `.venv`, not new dependencies. `uv` commands:

```powershell
$env:UV_CACHE_DIR=Join-Path (Get-Location) '.local-logs/uv-cache'
uv run --python .venv/Scripts/python.exe --no-sync pytest -q -p no:cacheprovider
uv run --python .venv/Scripts/python.exe --no-sync mypy geometry database backend cad
uv run --python .venv/Scripts/python.exe --no-sync python -m scripts.audit_climoptix --output-dir .local-logs/climoptix-examples --gmsh 'C:/Program Files/FreeCAD 26.3/bin/gmsh.exe'
```

From `frontend/`: `pnpm test`, `pnpm typecheck`, `pnpm lint`.
Production build requires both flags, or `out/` can remain stale:

```powershell
$env:PLANNER_STATIC_EXPORT='true'
$env:NEXT_PUBLIC_BASE_PATH='/planner'
pnpm build
$env:PLAYWRIGHT_MODULE='C:/Users/Dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:BROWSER_ARTIFACTS='C:/Users/Dell/Documents/ChatGPT/Online refurbishment planner/.local-logs'
pnpm test:browser
```

Targeted browser command: `node --import tsx --require ./tests/css-register.cjs
--test --test-concurrency=1 tests/browser/climoptix.browser.mts` (one line).
Worker checks from root: `node --test deployment/planner-worker.test.mjs`.
Full tests/Chrome/build may need approved sandbox elevation for Windows temp
access. Use short-yield commands and keep the user informed.

Pinned cached Prettier (no package/dependency edits needed):
`C:/Users/Dell/AppData/Local/pnpm-cache/dlx/0e968f2f538f27a695c570b1b4c89626/.pnpm-store/v11/links/@/prettier/3.6.2/75ee6ab1d0d576e29c0e1d8407ab8ec6e66b110f4ae2901b00e2b7bef305f677/node_modules/prettier/bin/prettier.cjs`.
Run via `node <path> --write <exact new files>`, not `pnpm dlx` (unnecessary
network lookup). Use `apply_patch` for source edits.

## Preserve pre-existing changes

This checkout was dirty before Climoptix. Completed room-specific roofs and
opening balustrades (five styles, catalogue proxies and tests) are uncommitted
and overlap several integration files. Preserve them; baseline before Climoptix
was 468 Python, 527 frontend unit, 15 project, 32 browser and 10 worker tests.
Also preserve unrelated dirty `freefloorplan3d-website` gitlink,
`frontend/next-env.d.ts` and `.codex-remote-attachments/`.
Do not reset/revert or broadly reformat. No new branch, commit, push or remote
solver/deployment is authorized by this paused request.
